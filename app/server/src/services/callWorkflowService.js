import twilio from 'twilio';
import crypto from 'crypto';
import { prisma } from '../lib/db.js';
import { callQueue } from '../lib/queues.js';
import { OrderStateMachine, OrderStatus } from './OrderStateMachine.js';
import { AICallInterpretationService } from './aiCallInterpretationService.js';
import { WhatsAppFallbackService } from './whatsappFallbackService.js';
import { OrderEligibilityService } from './orderEligibilityService.js';

/**
 * End-to-End Call Workflow & Telephony Orchestration Service
 * 
 * Manages the complete lifecycle:
 * Eligible Order -> Queued -> Calling -> Status Callback / DTMF / AI Stream -> Interpretation -> State Transition -> Retry / WhatsApp Fallback
 */

export class CallWorkflowService {
  /**
   * Helper to retrieve authenticated Twilio client or null
   */
  static getTwilioClient() {
    if (process.env.TWILIO_ACCOUNT_SID?.startsWith('AC') && process.env.TWILIO_AUTH_TOKEN) {
      return twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    }
    return null;
  }

  /**
   * Initiates an outbound confirmation call for an order
   * 
   * @param {Object} params
   * @param {string} params.orderId - Database Order UUID or order name
   * @param {string} params.shopDomain - Domain of the store
   * @param {boolean} [params.force=false] - If true, bypasses operating hour checks for manual merchant "Call Now"
   * @returns {Promise<{ success: boolean, callId?: string, providerCallSid?: string, reason?: string }>}
   */
  static async initiateCall({ orderId, shopDomain, force = false }) {
    console.log(`📞 [CallWorkflow] Initiating call for order ${orderId} (Shop: ${shopDomain}, Force: ${force})`);

    const order = await prisma.order.findUnique({
      where: { id: String(orderId) },
      include: { shop: true, customer: true }
    });

    if (!order) {
      return { success: false, reason: 'ORDER_NOT_FOUND' };
    }

    const shop = order.shop;
    if (shop.domain !== shopDomain) {
      return { success: false, reason: 'UNAUTHORIZED_CROSS_TENANT_ACCESS' };
    }

    // In-flight call lock check
    if (order.callStatus === 'calling' && !force) {
      return { success: false, reason: 'CALL_ALREADY_IN_PROGRESS' };
    }

    // Eligibility check
    if (!force) {
      const eligibility = await OrderEligibilityService.checkOrderEligibility({ order, shop });
      if (!eligibility.eligible) {
        console.log(`⛔ [CallWorkflow] Order ${orderId} ineligible for call: ${eligibility.reason}`);
        return { success: false, reason: eligibility.reason };
      }
    }

    // Parse payload for product details
    let payload = {};
    if (order.payload) {
      try {
        payload = typeof order.payload === 'string' ? JSON.parse(order.payload) : order.payload;
      } catch (_) {}
    }

    let rawPhone =
      order.customer?.phone ||
      payload?.phone ||
      payload?.shipping_address?.phone ||
      payload?.billing_address?.phone ||
      payload?.customer?.phone;

    const phone = OrderEligibilityService.cleanPhoneNumber(rawPhone);
    if (!phone) {
      return { success: false, reason: 'INVALID_PHONE_NUMBER' };
    }

    const customerName =
      payload?.shipping_address?.name ||
      payload?.customer?.first_name ||
      order.customer?.firstName ||
      'Customer';

    const productName = payload?.line_items?.[0]?.title || 'your product';
    const productPrice = String(order.totalAmount || payload?.total_price || '0');

    // Create call record in database
    const callRecord = await prisma.call.create({
      data: {
        shopId: shop.id,
        orderId: order.id,
        outcome: 'Calling',
        intent: 'Order Confirmation',
        sentiment: 'Neutral',
        durationSec: 0
      }
    });

    // Update order status
    await prisma.order.update({
      where: { id: order.id },
      data: {
        callStatus: 'calling',
        lastCallAt: new Date()
      }
    });

    const twilioClient = this.getTwilioClient();
    const appUrl = (process.env.APP_URL || 'http://localhost:8787').replace(/\/$/, '');
    const fromNumber = process.env.TWILIO_FROM_NUMBER || process.env.TWILIO_PHONE_NUMBER;

    let providerCallSid = null;

    if (twilioClient && fromNumber && appUrl) {
      try {
        // Voice URL serves TwiML (with both live Gemini streaming & keypad fallback)
        const voiceUrl = `${appUrl}/twilio/voice?orderId=${encodeURIComponent(order.id)}&callId=${encodeURIComponent(callRecord.id)}&name=${encodeURIComponent(customerName)}&product=${encodeURIComponent(productName)}&price=${encodeURIComponent(productPrice)}`;
        const statusCallbackUrl = `${appUrl}/twilio/status?orderId=${encodeURIComponent(order.id)}&callId=${encodeURIComponent(callRecord.id)}&shop=${encodeURIComponent(shop.domain)}`;

        console.log(`🔗 [CallWorkflow] Dialing Twilio from ${fromNumber} to ${phone}`);
        const call = await twilioClient.calls.create({
          to: phone,
          from: fromNumber,
          url: voiceUrl,
          statusCallback: statusCallbackUrl,
          statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
          statusCallbackMethod: 'POST'
        });

        providerCallSid = call.sid;
        console.log(`✅ [CallWorkflow] Twilio call created: ${providerCallSid}`);

        // Update with provider SID
        await prisma.call.update({
          where: { id: callRecord.id },
          data: { providerCallSid }
        });

        await prisma.order.update({
          where: { id: order.id },
          data: { callSid: providerCallSid }
        });

      } catch (twilioErr) {
        console.error(`❌ [CallWorkflow] Twilio API call error: ${twilioErr.message}`);
        // If live carrier call fails, gracefully fallback
        await prisma.call.update({
          where: { id: callRecord.id },
          data: { outcome: 'Failed' }
        });
        await prisma.order.update({
          where: { id: order.id },
          data: { callStatus: 'failed', tag: `Call Error: ${twilioErr.message}` }
        });

        return {
          success: false,
          callId: callRecord.id,
          reason: `Twilio call failed: ${twilioErr.message}`
        };
      }
    } else {
      // Mock / Dry-Run mode when Twilio credentials are not configured or in development
      console.log(`ℹ️ [CallWorkflow] Running in dry-run mode (Twilio credentials unconfigured or local dev)`);
      providerCallSid = `dry_run_${crypto.randomUUID().substring(0, 12)}`;

      await prisma.call.update({
        where: { id: callRecord.id },
        data: { providerCallSid, outcome: 'Completed', durationSec: 35 }
      });

      await prisma.order.update({
        where: { id: order.id },
        data: { callSid: providerCallSid, callStatus: 'completed' }
      });
    }

    await prisma.complianceLog.create({
      data: {
        shopDomain: shop.domain,
        event: 'Outbound call placed',
        detail: `Call placed for Order ${order.id} to ${phone} (SID: ${providerCallSid})`
      }
    });

    return {
      success: true,
      callId: callRecord.id,
      providerCallSid
    };
  }

  /**
   * Handles call completion and customer decisions
   * 
   * @param {Object} params
   * @param {string} params.orderId - Order UUID
   * @param {string} params.shopDomain - Tenant Shop domain
   * @param {string} [params.callId] - Call record UUID
   * @param {string} [params.digits] - DTMF digits ('1' or '2')
   * @param {string} [params.transcript] - Full dialogue transcript
   * @param {string} [params.toolExecuted] - Direct AI tool called
   * @param {string} [params.callStatus] - Twilio status
   * @param {number} [params.durationSec] - Duration in seconds
   * @param {string} [params.recordingUrl] - Audio recording URL
   */
  static async handleCallResult({
    orderId,
    shopDomain,
    callId,
    digits,
    transcript,
    toolExecuted,
    callStatus,
    durationSec = 0,
    recordingUrl
  }) {
    console.log(`📊 [CallWorkflow] Handling call result for order ${orderId} (Status: ${callStatus}, Digits: ${digits}, Tool: ${toolExecuted})`);

    const order = await prisma.order.findUnique({
      where: { id: String(orderId) },
      include: { shop: true, customer: true }
    });

    if (!order) {
      console.warn(`⚠️ [CallWorkflow] Order ${orderId} not found`);
      return { success: false, reason: 'ORDER_NOT_FOUND' };
    }

    const shop = order.shop;

    // Interpret the outcome
    const decision = AICallInterpretationService.interpret({
      digits,
      transcript,
      toolExecuted,
      callStatus
    });

    console.log(`🧠 [CallWorkflow] Interpreted Decision:`, decision);

    // Update Call record if provided
    if (callId) {
      await prisma.call.update({
        where: { id: callId },
        data: {
          outcome: decision.result,
          durationSec: durationSec || (decision.result === 'CONFIRMED' ? 45 : 10),
          recordingUrl: recordingUrl || undefined,
          transcript: transcript || undefined,
          sentiment: decision.result === 'CONFIRMED' ? 'Positive' : (decision.result === 'REJECTED' ? 'Negative' : 'Neutral')
        }
      }).catch(err => console.warn('Could not update call row:', err.message));
    }

    // Read store settings for retries and fallback
    let settings = {};
    if (shop.settings) {
      try {
        settings = typeof shop.settings === 'string' ? JSON.parse(shop.settings) : shop.settings;
      } catch (_) {}
    }

    const aiCallingConfig = settings.aiCalling || {};
    const maxAttempts = Number(aiCallingConfig.maxAttempts || 3);
    const retryDelayMinutes = Number(aiCallingConfig.retryDelayMinutes || 15);
    const enableWhatsAppFallback = settings.whatsapp?.enableFallback !== false;

    // 1. Order Confirmation
    if (decision.result === 'CONFIRMED') {
      const stateMachine = new OrderStateMachine(order.id, shop.domain);
      await stateMachine.transition(OrderStatus.CONFIRMED);

      await prisma.order.update({
        where: { id: order.id },
        data: {
          callStatus: 'confirmed',
          tag: 'COD Confirmed via Call'
        }
      });

      await prisma.complianceLog.create({
        data: {
          shopDomain: shop.domain,
          event: 'Order Confirmed',
          detail: `Order ${order.id} confirmed via AI call (${decision.source})`
        }
      });

      return { success: true, outcome: 'CONFIRMED' };
    }

    // 2. Order Cancellation
    if (decision.result === 'REJECTED') {
      const stateMachine = new OrderStateMachine(order.id, shop.domain);
      await stateMachine.transition(OrderStatus.CANCELLED, 'Customer requested cancellation via call');

      await prisma.order.update({
        where: { id: order.id },
        data: {
          callStatus: 'cancelled',
          tag: 'COD Cancelled via Call'
        }
      });

      await prisma.complianceLog.create({
        data: {
          shopDomain: shop.domain,
          event: 'Order Cancelled',
          detail: `Order ${order.id} cancelled by customer via AI call`
        }
      });

      return { success: true, outcome: 'REJECTED' };
    }

    // 3. Callback Requested
    if (decision.result === 'CALLBACK_REQUESTED') {
      const delayMinutes = decision.callbackRequestedMinutes || 60;
      const delayMs = delayMinutes * 60 * 1000;

      await callQueue.add('callback', {
        orderId: order.id,
        shopId: shop.id,
        shopDomain: shop.domain,
        reason: decision.reason
      }, {
        delay: delayMs,
        jobId: `cb-${shop.id}-${order.id}-${Date.now()}`
      });

      await prisma.order.update({
        where: { id: order.id },
        data: {
          callStatus: 'callback_requested',
          tag: `Callback Scheduled (${delayMinutes}m)`
        }
      });

      await prisma.complianceLog.create({
        data: {
          shopDomain: shop.domain,
          event: 'Callback Scheduled',
          detail: `Callback scheduled for Order ${order.id} in ${delayMinutes} minutes`
        }
      });

      return { success: true, outcome: 'CALLBACK_REQUESTED' };
    }

    // 4. No Answer / Busy / Telephony Failure -> Retry or WhatsApp Fallback
    const isUnreachable = ['NO_ANSWER', 'BUSY', 'FAILED', 'UNKNOWN'].includes(decision.result);
    if (isUnreachable) {
      const currentRetryCount = order.retryCount || 0;
      const nextAttempt = currentRetryCount + 1;

      if (nextAttempt < maxAttempts) {
        // Enqueue automated retry with exponential backoff delay
        const delayMs = retryDelayMinutes * 60 * 1000;
        console.log(`⏳ [CallWorkflow] Scheduling retry attempt ${nextAttempt + 1} for Order ${order.id} in ${retryDelayMinutes}m`);

        await callQueue.add('retry-call', {
          orderId: order.id,
          shopId: shop.id,
          shopDomain: shop.domain,
          attempt: nextAttempt + 1
        }, {
          delay: delayMs,
          jobId: `retry-${shop.id}-${order.id}-${nextAttempt}`
        });

        await prisma.order.update({
          where: { id: order.id },
          data: {
            retryCount: nextAttempt,
            callStatus: 'pending',
            tag: `Retry Scheduled (Attempt ${nextAttempt + 1} in ${retryDelayMinutes}m)`
          }
        });

        return { success: true, outcome: 'RETRY_SCHEDULED', nextAttempt: nextAttempt + 1 };
      } else {
        // Retries exhausted! Trigger WhatsApp Fallback
        console.log(`🚨 [CallWorkflow] Max attempts (${maxAttempts}) reached for Order ${order.id}. Initiating WhatsApp fallback.`);

        await prisma.order.update({
          where: { id: order.id },
          data: {
            retryCount: nextAttempt,
            callStatus: 'failed',
            tag: 'Max Call Retries Reached'
          }
        });

        if (enableWhatsAppFallback) {
          const fallbackResult = await WhatsAppFallbackService.sendFallback({
            orderId: order.id,
            shopId: shop.id
          });
          return { success: true, outcome: 'WHATSAPP_FALLBACK_TRIGGERED', fallbackResult };
        }

        return { success: true, outcome: 'CALL_FAILED_MAX_RETRIES' };
      }
    }

    return { success: true, outcome: decision.result };
  }
}
