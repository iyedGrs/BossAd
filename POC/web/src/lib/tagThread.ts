import { Client } from "@langchain/langgraph-sdk";

/** Tags a newly created thread with which graph owns it, so ThreadSidebar
 * can filter its list to just that graph's threads. Fire-and-forget. */
export function tagThread(apiUrl: string, threadId: string, assistantId: string): void {
  new Client({ apiUrl }).threads.update(threadId, { metadata: { graph_id: assistantId } }).catch(() => {});
}
