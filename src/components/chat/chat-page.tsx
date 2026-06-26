'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import { ConversationList } from './conversation-list';
import { ChatWindow } from './chat-window';
import { ChatTabBar, type OpenTab } from './chat-tab-bar';
import { WelcomeScreen } from './welcome-screen';
import { ErrorBoundary } from '@/components/common/error-boundary';

import { Conversation, Message } from '@/lib/types';
export type { Conversation, Message };

/** Per-tab state */
interface TabState {
  messages: Message[];
  streamingContent: string;
  streamingSources: Message['sources'];
  streamingConfidence: number | null;
  streamingConfidenceBreakdown: import('@/lib/types').ConfidenceBreakdown | null;
  isLoading: boolean;
  isSending: boolean;
  activeDelegations: Array<{
    child_bot_name: string;
    child_bot_id: string;
    intent: string | null;
    confidence: number;
    collaborations: number;
  }>;
}

export function ChatPage() {
  return (
    <ErrorBoundary>
      <ChatPageInner />
    </ErrorBoundary>
  );
}

function ChatPageInner() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [openTabs, setOpenTabs] = useState<OpenTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [tabStates, setTabStates] = useState<Record<string, TabState>>({});
  const abortRefs = useRef<Record<string, AbortController>>({});
  const listAbortRef = useRef<AbortController | null>(null);

  // Load conversation list
  const loadConversations = useCallback(async () => {
    listAbortRef.current?.abort();
    const controller = new AbortController();
    listAbortRef.current = controller;
    try {
      const res = await fetch('/api/conversations', { signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.conversations) {
        setConversations(data.conversations);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      console.error('加载对话列表失败:', err);
      toast.error('加载对话列表失败，请刷新重试');
    }
  }, []);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  // Cleanup AbortControllers on unmount
  useEffect(() => {
    return () => {
      Object.values(abortRefs.current).forEach((ctrl) => ctrl.abort());
      listAbortRef.current?.abort();
    };
  }, []);

  // Helper: get tab state with defaults
  const getTabState = useCallback(
    (convId: string): TabState =>
      tabStates[convId] ?? { messages: [], streamingContent: '', streamingSources: null, streamingConfidence: null, streamingConfidenceBreakdown: null, isLoading: false, isSending: false, activeDelegations: [] },
    [tabStates],
  );

  // Helper: update a single tab's state
  const updateTabState = useCallback((convId: string, patch: Partial<TabState>) => {
    setTabStates((prev) => ({
      ...prev,
      [convId]: { ...(prev[convId] ?? { messages: [], streamingContent: '', streamingSources: null, streamingConfidence: null, streamingConfidenceBreakdown: null, isLoading: false, isSending: false, activeDelegations: [] }), ...patch },
    }));
  }, []);

  // Load messages for a conversation
  const loadMessages = useCallback(async (convId: string) => {
    updateTabState(convId, { isLoading: true });
    try {
      const res = await fetch(`/api/conversations/${convId}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.messages) {
        updateTabState(convId, { messages: data.messages, isLoading: false });
      }
      // Sync summary from conversation detail to list state
      if (data.conversation?.summary !== undefined) {
        setConversations((prev) =>
          prev.map((c) => (c.id === convId ? { ...c, summary: data.conversation.summary } : c)),
        );
      }
    } catch (err) {
      console.error('加载消息失败:', err);
      toast.error('加载消息失败，请重试');
      updateTabState(convId, { isLoading: false });
    }
  }, [updateTabState]);

  // Open a tab (or switch to existing)
  const handleOpenTab = useCallback(
    (convId: string) => {
      const conv = conversations.find((c) => c.id === convId);
      if (!conv) return;

      // Clear unread
      setConversations((prev) =>
        prev.map((c) => (c.id === convId ? { ...c, unread_count: 0 } : c)),
      );

      // If tab already open, just switch
      setOpenTabs((prev) => {
        const existing = prev.find((t) => t.id === convId);
        if (existing) {
          setActiveTabId(convId);
          return prev;
        }
        // Open new tab
        const newTab: OpenTab = {
          id: convId,
          title: conv.title,
          source: conv.source,
          priority: conv.priority,
        };
        setActiveTabId(convId);
        return [...prev, newTab];
      });

      // Load messages if not cached
      if (!tabStates[convId]?.messages?.length) {
        loadMessages(convId);
      }
    },
    [conversations, tabStates, loadMessages],
  );

  // Close a tab
  const handleCloseTab = useCallback(
    (convId: string) => {
      setOpenTabs((prev) => {
        const idx = prev.findIndex((t) => t.id === convId);
        const next = prev.filter((t) => t.id !== convId);
        // Switch to adjacent tab
        if (activeTabId === convId) {
          if (next.length > 0) {
            const newActive = next[Math.min(idx, next.length - 1)];
            setActiveTabId(newActive.id);
          } else {
            setActiveTabId(null);
          }
        }
        return next;
      });
      // Abort any in-flight request
      abortRefs.current[convId]?.abort();
      delete abortRefs.current[convId];
      // Clean up tab state
      setTabStates((prev) => {
        const next = { ...prev };
        delete next[convId];
        return next;
      });
    },
    [activeTabId],
  );

  // Create new conversation (shared by both "New" and "Restart" actions)
  const createAndOpenConversation = useCallback(async () => {
    try {
      // 浏览器访客标识：首次访问生成 UUID 并存入 localStorage
      // 同一浏览器再次进线会被识别为同一客户（customer external_id）
      let visitorId: string | null = null;
      try {
        visitorId = window.localStorage.getItem('sa_visitor_id');
        if (!visitorId) {
          visitorId = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
            ? crypto.randomUUID()
            : `v-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
          window.localStorage.setItem('sa_visitor_id', visitorId);
        }
      } catch {
        // localStorage 不可用时降级为本次会话 ID
        visitorId = `vs${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
      }

      const res = await fetch('/api/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: '新对话', source: 'web', visitor_id: visitorId }),
      });
      if (!res.ok) throw new Error('创建对话失败');
      const data = await res.json();
      if (data.conversation) {
        setConversations((prev) => [data.conversation, ...prev]);
        const newTab: OpenTab = {
          id: data.conversation.id,
          title: data.conversation.title,
        };
        setOpenTabs((prev) => [...prev, newTab]);
        setActiveTabId(data.conversation.id);
        updateTabState(data.conversation.id, {
          messages: [],
          streamingContent: '',
          isLoading: false,
          isSending: false,
        });
      }
    } catch (err) {
      console.error('创建对话失败:', err);
      toast.error('创建对话失败，请重试');
    }
  }, [updateTabState]);

  // Create new conversation (alias for readability)
  const handleNewConversation = createAndOpenConversation;

  // Send message (streaming) for a specific conversation
  const handleSendMessage = useCallback(
    async (content: string, imageUrl?: string) => {
      const convId = activeTabId;
      if (!convId) return;
      const tabState = getTabState(convId);
      if (tabState.isSending) return;

      // If imageUrl is a local blob URL, upload it first
      let finalImageUrl = imageUrl;
      if (imageUrl && imageUrl.startsWith('blob:')) {
        try {
          // Fetch the blob from the local URL
          const blobResp = await fetch(imageUrl);
          const blob = await blobResp.blob();
          const formData = new FormData();
          formData.append('file', blob, 'image.jpg');
          const uploadResp = await fetch('/api/upload', {
            method: 'POST',
            body: formData,
          });
          if (uploadResp.ok) {
            const uploadData = await uploadResp.json();
            finalImageUrl = uploadData.url;
          } else {
            console.error('图片上传失败');
            toast.error('图片上传失败，请尝试重新上传');
            finalImageUrl = undefined;
          }
          // Revoke the local blob URL
          URL.revokeObjectURL(imageUrl);
        } catch (err) {
          console.error('图片上传异常:', err);
          toast.error('图片上传异常，请尝试重新上传');
          finalImageUrl = undefined;
        }
      }

      const tempUserMsg: Message = {
        id: `temp-${Date.now()}`,
        role: 'user',
        content,
        image_url: finalImageUrl || null,
        sources: null,
        created_at: new Date().toISOString(),
      };

      updateTabState(convId, {
        messages: [...(tabState.messages ?? []), tempUserMsg],
        isSending: true,
        streamingContent: '',
        streamingSources: null,
        streamingConfidence: null,
        streamingConfidenceBreakdown: null,
      });

      // Abort previous request for this conversation
      abortRefs.current[convId]?.abort();
      const controller = new AbortController();
      abortRefs.current[convId] = controller;

      try {
        const res = await fetch(`/api/conversations/${convId}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content, image_url: finalImageUrl || undefined }),
          signal: controller.signal,
        });

        if (!res.ok) {
          // Try to parse error response for a meaningful message
          let errorMsg = '发送失败';
          try {
            const errData = await res.json();
            if (errData.error) errorMsg = errData.error;
          } catch { /* ignore */ }
          throw new Error(errorMsg);
        }

        const reader = res.body?.getReader();
        if (!reader) throw new Error('无法读取流');

        const decoder = new TextDecoder();
        let fullContent = '';
        let sources: Message['sources'] = null;
        const delegations: Message['delegations'] = [];
        let knowledgeImages: Array<{ url: string; alt: string }> = [];
        let lastConfidence: number | null = null;
        let lastConfidenceBreakdown: import('@/lib/types').ConfidenceBreakdown | null = null;

        // Timeout: if no data received for 60 seconds, abort the stream
        let timeoutId = setTimeout(() => {
          controller.abort();
        }, 60000);

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          // Reset timeout on each chunk received
          clearTimeout(timeoutId);
          timeoutId = setTimeout(() => {
            controller.abort();
          }, 60000);

          const text = decoder.decode(value, { stream: true });
          const lines = text.split('\n');

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const parsed = JSON.parse(line.slice(6));
                if (parsed.content) {
                  fullContent += parsed.content;
                  updateTabState(convId, { streamingContent: fullContent });
                }
                if (parsed.done) {
                  sources = parsed.sources || null;
                  // Capture confidence and breakdown from SSE
                  if (parsed.confidence !== undefined) {
                    lastConfidence = parsed.confidence;
                  }
                  if (parsed.confidence_breakdown) {
                    lastConfidenceBreakdown = parsed.confidence_breakdown;
                  }
                  // Update streaming sources for source panel
                  updateTabState(convId, {
                    streamingSources: sources,
                    streamingConfidence: lastConfidence,
                    streamingConfidenceBreakdown: lastConfidenceBreakdown,
                  });
                }
                if (parsed.error) {
                  fullContent += `\n\n[错误: ${parsed.error}]`;
                  updateTabState(convId, { streamingContent: fullContent });
                }
                // Handle handoff signal from server (e.g. multimodal disabled + image sent)
                if (parsed.handoff) {
                  // Auto-trigger handoff after stream ends
                  setTimeout(async () => {
                    try {
                      const handoffRes = await fetch(`/api/conversations/${convId}/handoff`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ reason: '多模态识别未开启，图片需人工处理' }),
                      });
                      if (handoffRes.ok) {
                        const data = await handoffRes.json();
                        setConversations((prev) =>
                          prev.map((c) => (c.id === convId ? { ...c, status: 'handoff', summary: data.summary ?? c.summary } : c)),
                        );
                        setOpenTabs((prev) => prev.map((t) => (t.id === convId ? { ...t, status: 'handoff' as const } : t)));
                      }
                    } catch { /* ignore handoff failure */ }
                  }, 300);
                }
                // Handle sub-agent delegation events
                if (parsed.delegation) {
                  delegations.push(parsed.delegation);
                  updateTabState(convId, { activeDelegations: [...delegations] });
                }
                // Handle knowledge image references from AI response
                if (parsed.images && Array.isArray(parsed.images)) {
                  knowledgeImages = parsed.images;
                }
              } catch {
                // skip malformed chunks
              }
            }
          }
        }

        clearTimeout(timeoutId);

        const assistantMsg: Message = {
          id: `msg-${Date.now()}`,
          role: 'assistant',
          content: fullContent,
          sources,
          confidence: lastConfidence,
          confidence_breakdown: lastConfidenceBreakdown,
          delegations: delegations.length > 0 ? delegations : undefined,
          message_type: knowledgeImages.length > 0 ? 'knowledge_images' : undefined,
          rich_content: knowledgeImages.length > 0 ? { type: 'knowledge_images', data: {}, images: knowledgeImages } : undefined,
          created_at: new Date().toISOString(),
        };

        // Use fresh state to append assistant message
        setTabStates((prev) => {
          const ts = prev[convId] ?? { messages: [], streamingContent: '', streamingSources: null, streamingConfidence: null, streamingConfidenceBreakdown: null, isLoading: false, isSending: false, activeDelegations: [] };
          return {
            ...prev,
            [convId]: {
              ...ts,
              messages: [...ts.messages, assistantMsg],
              streamingContent: '',
              isSending: false,
            },
          };
        });

        loadConversations();
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          // Stream was aborted — could be timeout or user navigation
          const ts = tabStates[convId];
          if (ts?.streamingContent) {
            // We had partial content; preserve it as a partial message
            const partialMsg: Message = {
              id: `msg-partial-${Date.now()}`,
              role: 'assistant',
              content: ts.streamingContent + '\n\n[回复超时，内容可能不完整]',
              sources: null,
              created_at: new Date().toISOString(),
            };
            setTabStates((prev) => {
              const t = prev[convId] ?? { messages: [], streamingContent: '', streamingSources: null, streamingConfidence: null, streamingConfidenceBreakdown: null, isLoading: false, isSending: false, activeDelegations: [] };
              return {
                ...prev,
                [convId]: {
                  ...t,
                  messages: [...t.messages, partialMsg],
                  streamingContent: '',
                  isSending: false,
                },
              };
            });
          } else {
            updateTabState(convId, { isSending: false });
            toast.error('回复超时，请重试');
          }
          return;
        }
        console.error('发送消息失败:', err);
        toast.error('发送消息失败，请重试');
        updateTabState(convId, { isSending: false });
      }
    },
    [activeTabId, getTabState, updateTabState, loadConversations],
  );

  // Submit rating
  const handleSubmitRating = useCallback(
    async (rating: number, comment: string) => {
      if (!activeTabId) return;
      try {
        await fetch(`/api/conversations/${activeTabId}/rating`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rating, comment }),
        });
        loadConversations();
      } catch (err) {
        console.error('提交评价失败:', err);
        toast.error('提交评价失败，请重试');
      }
    },
    [activeTabId, loadConversations],
  );

  // End conversation
  const handleEndConversation = useCallback(
    async (convId: string) => {
      try {
        await fetch(`/api/conversations/${convId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'ended' }),
        });
        setConversations((prev) =>
          prev.map((c) => (c.id === convId ? { ...c, status: 'ended' } : c)),
        );
        // Also update tab title if needed
        setOpenTabs((prev) => prev.map((t) => (t.id === convId ? { ...t, status: 'ended' as const } : t)));
      } catch (err) {
        console.error('结束对话失败:', err);
        toast.error('结束对话失败，请重试');
      }
    },
    [],
  );

  // Handoff to human agent
  const handleHandoff = useCallback(
    async (convId: string, reason?: string) => {
      try {
        const res = await fetch(`/api/conversations/${convId}/handoff`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: reason || '用户请求转人工' }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setConversations((prev) =>
          prev.map((c) => (c.id === convId ? { ...c, status: 'handoff', summary: data.summary ?? c.summary } : c)),
        );
        setOpenTabs((prev) => prev.map((t) => (t.id === convId ? { ...t, status: 'handoff' as const } : t)));
        // Reload messages to show the system handoff message
        loadMessages(convId);
      } catch (err) {
        console.error('转人工失败:', err);
        toast.error('转人工失败，请重试');
      }
    },
    [loadMessages],
  );

  // Restart conversation (reuses createAndOpenConversation — fix CQ-03)
  const handleRestartConversation = createAndOpenConversation;

  // Current active conversation & tab state
  const activeConversation = conversations.find((c) => c.id === activeTabId);
  const activeTabState = activeTabId ? getTabState(activeTabId) : null;

  return (
    <div className="flex h-full min-h-0">
      <ConversationList
        conversations={conversations}
        openTabIds={openTabs.map((t) => t.id)}
        activeId={activeTabId}
        onSelect={handleOpenTab}
        onNew={handleNewConversation}
      />
      <div className="flex-1 min-w-0 min-h-0 flex flex-col">
        {openTabs.length > 0 ? (
          <>
            <ChatTabBar
              tabs={openTabs}
              activeId={activeTabId}
              onSelect={setActiveTabId}
              onClose={handleCloseTab}
            />
            <ChatWindow
              conversation={activeConversation}
              messages={activeTabState?.messages ?? []}
              streamingContent={activeTabState?.streamingContent ?? ''}
              streamingSources={activeTabState?.streamingSources ?? null}
              streamingConfidence={activeTabState?.streamingConfidence ?? null}
              streamingConfidenceBreakdown={activeTabState?.streamingConfidenceBreakdown ?? null}
              isLoading={activeTabState?.isLoading ?? false}
              isSending={activeTabState?.isSending ?? false}
              activeDelegations={activeTabState?.activeDelegations ?? []}
              allConversations={conversations}
              onSend={handleSendMessage}
              onSubmitRating={handleSubmitRating}
              onEndConversation={handleEndConversation}
              onRestartConversation={handleRestartConversation}
              onHandoff={handleHandoff}
            />
          </>
        ) : (
          <WelcomeScreen onNew={handleNewConversation} />
        )}
      </div>
    </div>
  );
}
