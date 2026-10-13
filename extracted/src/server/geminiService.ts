import { GoogleGenAI } from '@google/genai';

let aiInstance: GoogleGenAI | null = null;

function getAIClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY' || apiKey.trim() === '') {
    return null;
  }
  if (!aiInstance) {
    aiInstance = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return aiInstance;
}

export async function askGemini(prompt: string, context?: string): Promise<{ text: string; success: boolean }> {
  try {
    const ai = getAIClient();
    if (!ai) {
      return {
        text: '⚠️ YASHI HALLS AI Engine key is not configured on the server. Please add GEMINI_API_KEY in the Secrets / Environment panel to enable AI responses.',
        success: false,
      };
    }

    const systemInstruction = context 
      ? `You are YASHI HALLS, a smart and friendly WhatsApp Assistant powered by YASHI HALLS. Keep responses concise, clear, and easy to read on mobile. Context: ${context}`
      : 'You are YASHI HALLS, an advanced WhatsApp bot assistant powered by YASHI HALLS. Keep responses helpful, well-formatted, and concise for chat.';

    let response;
    try {
      response = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: prompt,
        config: {
          systemInstruction,
          temperature: 0.7,
        },
      });
    } catch (primaryErr: any) {
      // Fallback to flash-latest if model is busy or experiences high demand
      response = await ai.models.generateContent({
        model: 'gemini-flash-latest',
        contents: prompt,
        config: {
          systemInstruction,
          temperature: 0.7,
        },
      });
    }

    const output = response.text?.trim() || 'No response generated from YASHI HALLS AI.';
    return { text: output, success: true };
  } catch (error: any) {
    console.error('AI Engine Error:', error?.message || error);
    const errMsg = error?.message || String(error);
    if (errMsg.includes('503') || errMsg.includes('high demand') || errMsg.includes('UNAVAILABLE')) {
      return {
        text: '⏳ YASHI HALLS AI is currently experiencing high traffic. Please try your question again in a moment.',
        success: false,
      };
    }
    if (errMsg.includes('API_KEY_INVALID') || errMsg.includes('403')) {
      return {
        text: '⚠️ Invalid AI Engine key. Please check your GEMINI_API_KEY environment variable.',
        success: false,
      };
    }
    return {
      text: `❌ YASHI HALLS AI Notice: Unable to generate response (${errMsg.slice(0, 100)})`,
      success: false,
    };
  }
}
