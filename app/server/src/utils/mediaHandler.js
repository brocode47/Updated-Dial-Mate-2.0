/**
 * Media Preparation Handler for WhatsApp Messages
 * Prepares metadata for image, audio, and document payloads without executing vision/audio models yet.
 */

export function parseMediaMetadata(payload = {}) {
  const type = (payload.type || '').toLowerCase();
  const caption = (payload.caption || payload.content || '').trim();
  const fileUrl = payload.fileUrl || null;
  const fileName = payload.fileName || (payload.key?.id ? `${payload.key.id}` : null);
  const mimeType = payload.mimetype || payload.mimeType || null;
  const duration = payload.duration || payload.seconds || null;

  // 1. Image message (e.g. imageMessage, image, IMAGE)
  if (type.includes('image')) {
    return {
      isMedia: true,
      mediaType: 'image',
      metadata: {
        fileUrl,
        fileName: fileName ? (fileName.includes('.') ? fileName : `${fileName}.jpg`) : 'image.jpg',
        mimeType: mimeType || 'image/jpeg',
        caption: caption || null
      },
      promptText: caption
        ? `${caption} [Customer attached an image]`
        : '[Customer attached an image]'
    };
  }

  // 2. Audio message / Voice note (e.g. audioMessage, voice, AUDIO, audio)
  if (type.includes('audio') || type.includes('voice')) {
    return {
      isMedia: true,
      mediaType: 'audio',
      metadata: {
        fileUrl,
        fileName: fileName ? (fileName.includes('.') ? fileName : `${fileName}.ogg`) : 'voice.ogg',
        mimeType: mimeType || 'audio/ogg',
        durationSeconds: duration ? Number(duration) : null,
        caption: caption || null
      },
      promptText: caption
        ? `${caption} [Customer sent a voice note]`
        : 'Assalam o Alaikum, main ne voice note bheja hai.'
    };
  }

  // 3. Document message (e.g. documentMessage, document, DOCUMENT)
  if (type.includes('document')) {
    const docName = payload.fileName || (fileName ? `${fileName}.pdf` : 'document.pdf');
    return {
      isMedia: true,
      mediaType: 'document',
      metadata: {
        fileUrl,
        fileName: docName,
        mimeType: mimeType || 'application/pdf',
        caption: caption || null
      },
      promptText: caption
        ? `${caption} [Customer sent document: ${docName}]`
        : `[Customer sent document: ${docName}]`
    };
  }

  // 4. Standard text or other payload
  return {
    isMedia: false,
    mediaType: 'text',
    metadata: null,
    promptText: caption
  };
}
