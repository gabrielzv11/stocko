import { generateText, type LanguageModel } from 'ai';
import { db } from './db';

/** Turns (question + answer) that always go to the model in full. */
const KEEP_TURNS = 2;

type Msg = { id: string; role: string; parts: unknown };

/** Messages after the summarized prefix: what the model still sees in full. */
export function unsummarized<M extends Msg>(messages: M[], summarizedUntilMessageId: string | null) {
	const i = summarizedUntilMessageId ? messages.findIndex((m) => m.id === summarizedUntilMessageId) : -1;
	return messages.slice(i + 1);
}

/** Index where the last KEEP_TURNS turns start (0 = nothing to fold). */
export function keptFrom(messages: Msg[], keepTurns = KEEP_TURNS) {
	let users = 0;
	for (let i = messages.length - 1; i >= 0; i--) if (messages[i]!.role === 'user' && ++users === keepTurns) return i;
	return 0;
}

const textOf = (parts: unknown) =>
	(parts as { type: string; text?: string }[])
		.filter((p) => p.type === 'text')
		.map((p) => p.text)
		.join('\n');

/**
 * Replaces the provisional title (question truncated) with a short one written by the model. Background, first turn only;
 * on failure or empty output the provisional title stays.
 */
export async function titleConversation(conversationId: string, question: string, model: LanguageModel, maxLength: number) {
	try {
		// ponytail: mesmo modelo do workspace e custo fora do teto diário, como o resumo; modelo barato dedicado se pesar.
		const { text } = await generateText({
			model,
			system:
				'Escreva um título curto (até 6 palavras) em português do Brasil para uma conversa que começa com a pergunta abaixo. Responda só com o título, sem aspas nem ponto final.',
			prompt: question.slice(0, 2000),
		});
		const title = text.replace(/\s+/g, ' ').replace(/^["'`*#\s]+|["'`*.\s]+$/g, '').slice(0, maxLength);
		if (title) await db.conversation.update({ where: { id: conversationId }, data: { title } });
	} catch (e) {
		console.error(`[title] ${conversationId}:`, e);
	}
}

// ponytail: in-process (1 réplica); Inngest com concorrência 1 por conversa se houver várias.
const running = new Set<string>();

/**
 * Folds every message before the last KEEP_TURNS turns into Conversation.summary (on top of the previous summary).
 * Runs after the turn, in the background; one per conversation at a time.
 */
export async function summarize(conversationId: string, model: LanguageModel) {
	if (running.has(conversationId)) return;
	running.add(conversationId);
	try {
		const conversation = await db.conversation.findUniqueOrThrow({
			where: { id: conversationId },
			include: { messages: { orderBy: { createdAt: 'asc' } } },
		});
		const pending = unsummarized(conversation.messages, conversation.summarizedUntilMessageId);
		const fold = pending.slice(0, keptFrom(pending));
		if (!fold.length) return;

		const transcript = fold.map((m) => `${m.role === 'user' ? 'Usuário' : 'Stocko'}: ${textOf(m.parts)}`).join('\n\n');
		// ponytail: o custo desta chamada não entra em Message.cost (nem no teto diário); gravar se pesar.
		const { text } = await generateText({
			model,
			system:
				'Você resume conversas entre um usuário e o Stocko, assistente que responde sobre código e APIs. Escreva em português do Brasil um resumo que substitua as mensagens: perguntas feitas, conclusões, decisões e pendências. Preserve literalmente as citações (`owner/repo/caminho#Lx-Ly@sha`, `api:<título> GET /path`), nomes de arquivos, branches, SHAs e números. Sem introdução.',
			prompt: [conversation.summary && `<resumo_anterior>\n${conversation.summary}\n</resumo_anterior>`, `<conversa>\n${transcript}\n</conversa>`]
				.filter(Boolean)
				.join('\n\n'),
		});
		await db.conversation.update({ where: { id: conversationId }, data: { summary: text, summarizedUntilMessageId: fold.at(-1)!.id } });
	} catch (e) {
		console.error(`[summary] ${conversationId}:`, e);
	} finally {
		running.delete(conversationId);
	}
}
