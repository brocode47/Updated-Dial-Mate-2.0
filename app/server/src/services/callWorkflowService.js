import twilio from 'twilio';
import crypto from 'crypto';
import { prisma } from '../lib/db.js';
import { callQueue } from '../lib/queues.js';
import { OrderStateMachine, OrderStatus } from './OrderStateMachine.js';
import { AICallInterpretationService } from './aiCallInterpretationService.js';
import { WhatsAppFallbackService } from './whatsappFallbackService.js';
import { OrderEligibilityService } from './orderEligibilityService.js';
import { CallScriptEngine } from './callScriptEngine.js';

/**
 * End-to-End Call Workflow & Telephony Orchestration Service
 * 
 * Manages the complete lifecycle:
 * Eligible Order -> Queued -> Whitelist & Safety Check -> Calling -> Status Callback / DTMF / AI Stream -> Interpretation -> State Transition -> Retry / WhatsApp Fallback
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
   * @param {boolean} [params.dryRun=false] - Explicit simulation flag
   * @returns {Promise<{ success: boolean, callId?: string, providerCallSid?: string, reason?: string, dryRun?: boolean }>}
   */
  static async initiateCall({ orderId, shopDomain, force = false, dryRun = false }) {
    console.log(`📞 [CallWorkflow] Initiating call for order ${orderId} (Shop: ${shopDomain}, Force: ${force}, DryRun: ${dryRun})`);

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

    // Safety 1: Emergency Stop Switch
    let shopSettings = {};
    if (shop.settings) {
      try {
        shopSettings = typeof shop.settings === 'string' ? JSON.parse(shop.settings) : shop.settings;
      } catch (_) {}
    }

    const isEmergencyStop = process.env.EMERGENCY_STOP === 'true' || Boolean(shopSettings.emergencyStop);
    if (isEmergencyStop) {
      console.warn(`🚨 [CallWorkflow] EMERGENCY STOP ACTIVE! Outbound call blocked for order ${orderId}`);
      await prisma.complianceLog.create({
        data: {
          shopDomain: shop.domain,
          event: 'Emergency Stop Active',
          detail: `Outbound call blocked for Order ${order.id} due to EMERGENCY_STOP switch`
        }
      });
      return { success: false, reason: 'EMERGENCY_STOP_ACTIVE' };
    }

    // Safety 2: In-flight call lock check
    if (order.callStatus === 'calling' && !force) {
      return { success: false, reason: 'CALL_ALREADY_IN_PROGRESS' };
    }

    // Safety 3: Daily Call Quota Limit
    const dailyLimit = Number(process.env.DAILY_CALL_LIMIT || 100);
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const todayCallsCount = typeof prisma.call?.count === 'function'
      ? await prisma.call.count({
          where: {
            shopId: shop.id,
            createdAt: { gte: startOfToday }
          }
        })
      : 0;

    if (todayCallsCount >= dailyLimit && !force) {
      console.warn(`🛑 [CallWorkflow] Daily call limit (${dailyLimit}) exceeded for shop ${shop.domain}`);
      await prisma.complianceLog.create({
        data: {
          shopDomain: shop.domain,
          event: 'Daily Call Limit Exceeded',
          detail: `Outbound call blocked for Order ${order.id}. Daily quota reached (${todayCallsCount}/${dailyLimit})`
        }
      });
      return { success: false, reason: 'DAILY_CALL_LIMIT_EXCEEDED' };
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
        outcome: 'Created',
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

    // Phase 6 Mode & Whitelist Evaluation
    const callMode = (process.env.AI_CALL_MODE || (process.env.DRY_RUN_CALLS === 'false' ? 'production' : 'test')).toLowerCase();
    const adminTestNumbers = (process.env.ADMIN_TEST_NUMBERS || '')
      .split(',')
      .map(n => OrderEligibilityService.cleanPhoneNumber(n))
      .filter(Boolean);

    let isWhitelisted = false;
    if (callMode === 'test') {
      isWhitelisted = adminTestNumbers.includes(phone);
      if (!isWhitelisted) {
        console.log(`🛡️ [Whitelist Protection] Phone ${phone} is not in ADMIN_TEST_NUMBERS (${adminTestNumbers.join(', ') || 'None'}). Safely executing dry-run simulation.`);
      } else {
        console.log(`🎯 [Whitelist Approved] Phone ${phone} matches test whitelist. Proceeding with real carrier call.`);
      }
    } else if (callMode === 'production') {
      isWhitelisted = true;
    }

    const shouldDialLiveCarrier = Boolean(
      !dryRun &&
      callMode !== 'dry_run' &&
      process.env.DRY_RUN_CALLS !== 'true' &&
      isWhitelisted &&
      twilioClient &&
      fromNumber &&
      appUrl
    );

    let providerCallSid = null;

    if (shouldDialLiveCarrier) {
      try {
        const orderNumber = order.orderNumber || (payload?.order_number ? String(payload.order_number) : order.id.slice(0, 6));
        const voiceUrl = `${appUrl}/twilio/voice?orderId=${encodeURIComponent(order.id)}&callId=${encodeURIComponent(callRecord.id)}&name=${encodeURIComponent(customerName)}&product=${encodeURIComponent(productName)}&price=${encodeURIComponent(productPrice)}&orderNumber=${encodeURIComponent(orderNumber)}`;
        const statusCallbackUrl = `${appUrl}/twilio/status?orderId=${encodeURIComponent(order.id)}&callId=${encodeURIComponent(callRecord.id)}&shop=${encodeURIComponent(shop.domain)}`;

        console.log(`🔗 [CallWorkflow: LIVE] Dialing Twilio from ${fromNumber} to ${phone} (Mode: ${callMode})`);
        const call = await twilioClient.calls.create({
          to: phone,
          from: fromNumber,
          url: voiceUrl,
          statusCallback: statusCallbackUrl,
          statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
          statusCallbackMethod: 'POST'
        });

        providerCallSid = call.sid;
        console.log(`✅ [CallWorkflow] Twilio live call created: ${providerCallSid}`);

        await prisma.call.update({
          where: { id: callRecord.id },
          data: { providerCallSid }
        });

        await prisma.order.update({
          where: { id: order.id },
          data: { callSid: providerCallSid }
        });

        await prisma.complianceLog.create({
          data: {
            shopDomain: shop.domain,
            event: 'Outbound Live Call Placed',
            detail: `Live Twilio call placed for Order ${order.id} to ${phone} (SID: ${providerCallSid}, Mode: ${callMode})`
          }
        });

        return {
          success: true,
          callId: callRecord.id,
          providerCallSid,
          liveCall: true
        };
      } catch (twilioErr) {
        console.error(`❌ [CallWorkflow] Twilio API call error: ${twilioErr.message}`);
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
      // Safe dry-run mode: Generate complete Twilio request and persist records without dialing external carrier
      const simulationReason = !isWhitelisted && callMode === 'test'
        ? 'Safely simulated: number not in test whitelist'
        : 'Dry-run mode active';

      console.log(`ℹ️ [CallWorkflow: SIMULATION] ${simulationReason}`);
      providerCallSid = `dry_run_${crypto.randomUUID().substring(0, 12)}`;

      const voiceUrl = `${appUrl || 'http://localhost:8787'}/twilio/voice?orderId=${encodeURIComponent(order.id)}&callId=${encodeURIComponent(callRecord.id)}&name=${encodeURIComponent(customerName)}&product=${encodeURIComponent(productName)}&price=${encodeURIComponent(productPrice)}`;
      const statusCallbackUrl = `${appUrl || 'http://localhost:8787'}/twilio/status?orderId=${encodeURIComponent(order.id)}&callId=${encodeURIComponent(callRecord.id)}&shop=${encodeURIComponent(shop.domain)}`;

      const twilioPayload = {
        to: phone,
        from: fromNumber || '+15550000000',
        url: voiceUrl,
        statusCallback: statusCallbackUrl
      };

      await prisma.call.update({
        where: { id: callRecord.id },
        data: { providerCallSid, outcome: 'Created', durationSec: 0 }
      });

      await prisma.order.update({
        where: { id: order.id },
        data: { callSid: providerCallSid, callStatus: 'calling' }
      });

      await prisma.complianceLog.create({
        data: {
          shopDomain: shop.domain,
          event: 'Dry-run call simulated',
          detail: `Simulated call for Order ${order.id} to ${phone} (SID: ${providerCallSid}, Reason: ${simulationReason})`
        }
      });

      return {
        success: true,
        callId: callRecord.id,
        providerCallSid,
        dryRun: true,
        simulationReason,
        twilioPayload
      };
    }
  }

  /**
   * Handles call completion and customer decisions
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

    // Interpret the outcome via AI interpretation service
    const decision = AICallInterpretationService.interpret({
      digits,
      transcript,
      toolExecuted,
      callStatus
    });

    console.log(`🧠 [CallWorkflow] Interpreted Decision:`, decision);

    // Format full transcript with AI summary
    const formattedTranscript = decision.summary
      ? `[AI Summary]: ${decision.summary}\n[Confidence]: ${Math.round((decision.confidence || 0) * 100)}%\n\n${transcript || ''}`.trim()
      : transcript || undefined;

    // Update Call record if provided
    if (callId) {
      await prisma.call.update({
        where: { id: callId },
        data: {
          outcome: decision.intent || decision.result,
          intent: decision.intent || 'Order Confirmation',
          sentiment: decision.customerEmotion || 'Neutral',
          durationSec: durationSec || (decision.result === 'CONFIRMED' ? 45 : 10),
          recordingUrl: recordingUrl || undefined,
          transcript: formattedTranscript
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
    if (decision.intent === 'CONFIRMED' || decision.result === 'CONFIRMED') {
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

      return { success: true, outcome: 'CONFIRMED', decision };
    }

    // 2. Order Cancellation
    if (decision.intent === 'CANCELLED' || decision.result === 'CANCELLED' || decision.result === 'REJECTED') {
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

      return { success: true, outcome: 'CANCELLED', decision };
    }

    // 3. Wrong Number / Not Placed By Customer
    if (decision.intent === 'WRONG_NUMBER' || decision.result === 'WRONG_NUMBER') {
      const stateMachine = new OrderStateMachine(order.id, shop.domain);
      await stateMachine.transition(OrderStatus.CANCELLED, 'Wrong phone number reported on call');

      await prisma.order.update({
        where: { id: order.id },
        data: {
          callStatus: 'failed',
          tag: 'Invalid Phone / Wrong Number'
        }
      });

      await prisma.complianceLog.create({
        data: {
          shopDomain: shop.domain,
          event: 'Wrong Number Reported',
          detail: `Customer on call reported order ${order.id} was not placed by them`
        }
      });

      return { success: true, outcome: 'WRONG_NUMBER', decision };
    }

    // 4. Callback Requested
    if (decision.intent === 'CALL_BACK' || decision.result === 'CALLBACK_REQUESTED') {
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

      return { success: true, outcome: 'CALL_BACK', decision };
    }

    // 5. No Answer / Busy / Telephony Failure -> Retry or WhatsApp Fallback
    const isUnreachable = ['NO_ANSWER', 'BUSY', 'FAILED', 'UNKNOWN'].includes(decision.result);
    if (isUnreachable) {
      const currentRetryCount = order.retryCount || 0;
      const nextAttempt = currentRetryCount + 1;

      if (nextAttempt < maxAttempts) {
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

        return { success: true, outcome: 'RETRY_SCHEDULED', nextAttempt: nextAttempt + 1, decision };
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
          return { success: true, outcome: 'WHATSAPP_FALLBACK_TRIGGERED', fallbackResult, decision };
        }

        return { success: true, outcome: 'CALL_FAILED_MAX_RETRIES', decision };
      }
    }

    return { success: true, outcome: decision.intent || decision.result, decision };
  }
}

export default CallWorkflowService;
