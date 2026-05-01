import {
  AudioLines,
  MessageSquareText,
  SmilePlus,
  PhoneCall,
  Clock,
  FileAudio
} from 'lucide-react?deps=react';

import { html } from '../jsx.js';
import { getCallTone } from '../utils.js';

export function CallList({ calls = [] }) {
  if (!calls.length) {
    return html`
      <div className="rounded-3xl border border-dashed border-[hsl(var(--border))] py-12 text-center">
        <div className="font-semibold">No calls yet</div>
        <div className="mt-1 text-sm text-[hsl(var(--foreground)/0.55)]">
          Calls will appear here once orders are processed.
        </div>
      </div>
    `;
  }

  return html`
    <div className="space-y-4">
      ${calls.map((call) => html`
        <div
          key=${call.id || call.callSid}
          className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 shadow-soft transition-all hover:shadow-medium"
        >
          <!-- HEADER -->
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2 font-semibold">
                <${PhoneCall} size=${16} />
                ${call.orderId || call.id || 'Unknown order'}
              </div>

              <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-[hsl(var(--foreground)/0.65)]">
                <span>${call.agent || 'AI Agent'}</span>
                <span>•</span>
                <span className="flex items-center gap-1">
                  <${Clock} size=${14} />
                  ${call.time || '—'}
                </span>
                <span>•</span>
                <span>${call.duration || '—'}</span>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <span
                className=${`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${getCallTone(call.outcome || call.status)}`}
              >
                ${call.outcome || call.status || 'unknown'}
              </span>

              ${call.intent
                ? html`
                    <span className="inline-flex rounded-full bg-[hsl(var(--secondary)/0.10)] px-3 py-1 text-xs font-semibold text-[hsl(var(--secondary))]">
                      ${call.intent}
                    </span>
                  `
                : null}
            </div>
          </div>

          <!-- DETAILS -->
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl bg-[hsl(var(--muted)/0.4)] p-3">
              <div className="flex items-center gap-2 text-sm font-medium">
                <${FileAudio} size=${16} /> Recording
              </div>
              <div className="mt-1 text-sm text-[hsl(var(--foreground)/0.66)]">
                ${call.recording || 'Recording not available yet'}
              </div>
            </div>

            <div className="rounded-xl bg-[hsl(var(--muted)/0.4)] p-3">
              <div className="flex items-center gap-2 text-sm font-medium">
                <${MessageSquareText} size=${16} /> Transcript
              </div>
              <div className="mt-1 line-clamp-3 text-sm text-[hsl(var(--foreground)/0.66)]">
                ${call.transcript || 'Transcript will appear after call completion'}
              </div>
            </div>

            <div className="rounded-xl bg-[hsl(var(--muted)/0.4)] p-3">
              <div className="flex items-center gap-2 text-sm font-medium">
                <${SmilePlus} size=${16} /> Sentiment
              </div>
              <div className="mt-1 text-sm text-[hsl(var(--foreground)/0.66)]">
                ${call.sentiment || 'Analyzing...'}
              </div>
            </div>
          </div>
        </div>
      `)}
    </div>
  `;
}