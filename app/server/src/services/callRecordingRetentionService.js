import { prisma } from '../lib/db.js';
import { CallWorkflowService } from './callWorkflowService.js';

export const MAX_STORED_CALL_RECORDINGS = 20;

// Mutex promise chain to ensure atomic execution during concurrent call completions
let retentionLock = Promise.resolve();

/**
 * Call Recording Retention Service for Dial Mate 2.0
 * 
 * Strict Invariant:
 * Retains only the MOST RECENT 20 call recordings.
 * When recording #21 arrives, the oldest recording media is deleted.
 * 
 * Safety Guarantees:
 * - Deletes actual stored audio media via Twilio REST API.
 * - Clears Call.recordingUrl ONLY after media deletion is confirmed.
 * - NEVER deletes Call rows, Order rows, Customer rows, transcripts, or compliance logs.
 * - Concurrency safe: Serialized execution prevents race conditions.
 */
export class CallRecordingRetentionService {
  static MAX_STORED_CALL_RECORDINGS = MAX_STORED_CALL_RECORDINGS;
  /**
   * Extracts Twilio Recording SID (RE...) from a recording URL or SID string
   */
  static extractRecordingSid(recordingUrlOrSid) {
    if (!recordingUrlOrSid) return null;
    const str = String(recordingUrlOrSid).trim();
    if (str.startsWith('RE') && str.length >= 34) {
      return str.split(/[\/\.]/)[0];
    }
    const match = str.match(/RE[0-9a-fA-F]{32}/);
    return match ? match[0] : null;
  }

  /**
   * Deletes underlying recording media from Twilio REST API
   * 
   * @param {string} recordingUrlOrSid - Twilio RecordingUrl or RecordingSid
   * @returns {Promise<boolean>} True if successfully deleted or already absent
   */
  static async deleteRecordingMedia(recordingUrlOrSid) {
    const recordingSid = this.extractRecordingSid(recordingUrlOrSid);
    if (!recordingSid) {
      console.warn(`⚠️ [RecordingRetention] No valid Twilio Recording SID found in "${recordingUrlOrSid}"`);
      return false;
    }

    const twilioClient = CallWorkflowService.getTwilioClient();
    if (!twilioClient) {
      console.warn(`⚠️ [RecordingRetention] Twilio client not available to delete recording ${recordingSid}`);
      return false;
    }

    try {
      console.log(`🗑️ [RecordingRetention] Deleting Twilio media recording ${recordingSid}...`);
      await twilioClient.recordings(recordingSid).remove();
      console.log(`✅ [RecordingRetention] Twilio media recording ${recordingSid} deleted.`);
      return true;
    } catch (err) {
      // If already deleted or not found (404 / 20404), treat as confirmed deleted
      if (err.status === 404 || err.code === 20404) {
        console.log(`ℹ️ [RecordingRetention] Recording ${recordingSid} was already removed from Twilio.`);
        return true;
      }
      console.error(`❌ [RecordingRetention] Failed to delete Twilio recording ${recordingSid}:`, err.message);
      return false;
    }
  }

  /**
   * Strictly enforces the rolling 20-recording limit:
   * Keeps the MOST RECENT 20 call recordings (ordered by createdAt DESC).
   * Excess older recordings (>20) have their media deleted and recordingUrl cleared.
   * NEVER deletes Call records, Order records, Customer records, or transcripts.
   * 
   * @param {Object} [options={}]
   * @param {string} [options.shopId=null] - Optional shop scoping
   * @param {number} [options.limit=MAX_STORED_CALL_RECORDINGS] - Maximum recordings to retain (default: 20)
   * @returns {Promise<{ success: boolean, totalRecordings: number, retainedCount: number, deletedCount: number, limit: number }>}
   */
  static async enforceRetention(options = {}) {
    const execute = async () => {
      const limit = Number(options.limit || MAX_STORED_CALL_RECORDINGS);
      const shopId = options.shopId || null;

      const whereClause = {
        recordingUrl: { not: null },
        ...(shopId ? { shopId } : {})
      };

      // Fetch calls with stored recording media, ordered newest first
      const callsWithRecordings = await prisma.call.findMany({
        where: whereClause,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          shopId: true,
          orderId: true,
          recordingUrl: true,
          createdAt: true
        }
      });

      const totalCount = callsWithRecordings.length;

      if (totalCount <= limit) {
        return {
          success: true,
          totalRecordings: totalCount,
          retainedCount: totalCount,
          deletedCount: 0,
          limit
        };
      }

      // Identify excess oldest recordings beyond the newest 'limit' (e.g. 20)
      const excessCalls = callsWithRecordings.slice(limit);
      console.log(`🧹 [RecordingRetention] Enforcing retention: ${totalCount} recordings found, limit=${limit}. Deleting ${excessCalls.length} oldest...`);

      let deletedCount = 0;
      for (const call of excessCalls) {
        const deletedFromMedia = await this.deleteRecordingMedia(call.recordingUrl);
        if (deletedFromMedia) {
          // Clear recording reference in DB only after media deletion is confirmed
          await prisma.call.update({
            where: { id: call.id },
            data: { recordingUrl: null }
          });

          if (typeof prisma.complianceLog?.create === 'function') {
            await prisma.complianceLog.create({
              data: {
                event: 'Call Recording Retention Cleaned',
                detail: `Deleted excess recording media for Call ${call.id} (Media: ${call.recordingUrl}) to maintain MAX_STORED_CALL_RECORDINGS=${limit}`
              }
            }).catch(() => {});
          }

          deletedCount++;
        } else {
          console.warn(`⚠️ [RecordingRetention] Preserving DB reference for Call ${call.id} because media deletion could not be verified.`);
        }
      }

      const finalCount = await prisma.call.count({
        where: whereClause
      });

      console.log(`✅ [RecordingRetention] Retention complete. Final count=${finalCount} (Limit=${limit}, Deleted=${deletedCount})`);

      return {
        success: true,
        totalRecordings: finalCount,
        retainedCount: finalCount,
        deletedCount,
        limit
      };
    };

    retentionLock = retentionLock.then(execute, execute);
    return retentionLock;
  }
}

export const callRecordingRetentionService = CallRecordingRetentionService;
export default CallRecordingRetentionService;
