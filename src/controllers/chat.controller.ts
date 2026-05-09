import { Response, NextFunction } from 'express';
import { AppError } from '../middleware/error.middleware';
import { AuthRequest } from '../types';
import { streamCopilotResponse, ChatHistoryItem } from '../services/chat.service';

function writeSSE(res: Response, data: string) {
  res.write(`data: ${data}\n\n`);
  // Flush compressed buffers if compression middleware is active
  if (typeof (res as Response & { flush?: () => void }).flush === 'function') {
    (res as Response & { flush: () => void }).flush();
  }
}

export async function streamChat(req: AuthRequest, res: Response, next: NextFunction) {
  const { message, history } = req.body as {
    message?: string;
    history?: { role: string; content: string }[];
  };

  // ── Validate before committing to SSE ────────────────────────────────────
  if (!message || typeof message !== 'string' || !message.trim()) {
    return next(new AppError('message is required', 400));
  }
  if (message.length > 2000) {
    return next(new AppError('Message too long (max 2000 characters)', 400));
  }

  // Sanitise history: only accept valid role values, cap at 20 turns
  const validHistory: ChatHistoryItem[] = [];
  if (Array.isArray(history)) {
    for (const item of history.slice(-20)) {
      if (
        (item.role === 'user' || item.role === 'model') &&
        typeof item.content === 'string' &&
        item.content.trim()
      ) {
        validHistory.push({ role: item.role, content: item.content.trim() });
      }
    }
  }

  // ── Commit to SSE stream ──────────────────────────────────────────────────
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no', // disable nginx/proxy buffering
  });

  const { role, storeId } = req.user!;

  try {
    const generator = streamCopilotResponse(message.trim(), validHistory, role, storeId);

    for await (const chunk of generator) {
      writeSSE(res, JSON.stringify({ text: chunk }));
    }

    writeSSE(res, '[DONE]');
  } catch (err: unknown) {
    let errMsg = 'An unexpected error occurred. Please try again.';

    if (err instanceof AppError) {
      errMsg = err.message;
    } else if (err instanceof Error) {
      if (err.message.includes('API_KEY_INVALID') || err.message.includes('INVALID_ARGUMENT')) {
        errMsg = 'Invalid Gemini API key. Check GEMINI_API_KEY in backend/.env';
      } else if (err.message.includes('RESOURCE_EXHAUSTED') || err.message.includes('429')) {
        errMsg = 'Gemini free-tier quota exceeded. Please wait a moment and try again.';
      } else if (err.message.includes('503') || err.message.includes('UNAVAILABLE')) {
        errMsg = 'Gemini is temporarily unavailable. Please try again in a few seconds.';
      } else {
        errMsg = err.message;
      }
    }

    res.write(`event: error\ndata: ${JSON.stringify({ message: errMsg })}\n\n`);
  } finally {
    res.end();
  }
}
