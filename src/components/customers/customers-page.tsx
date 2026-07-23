'use client';

import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import {
  Search, Plus, X, Tag, Users, Globe, ShoppingBag, Music,
  Edit3, Trash2, ChevronRight, MessageSquare, StickyNote, Palette,
  Phone, Mail, Clock, UserCheck, Calendar, Star,
  ChevronDown, Download, Loader2
} from 'lucide-react';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Popover, PopoverContent, PopoverTrigger,
} from '@/components/ui/popover';
import {
  Command, CommandInput, CommandList, CommandEmpty, CommandItem,
} from '@/components/ui/command';
import type { Customer, CustomerTag, CustomerSource } from '@/lib/types';
import { MarkdownRenderer } from '@/components/chat/markdown-renderer';
import { SOURCE_PLATFORM_LABELS } from '@/lib/types';
import { useDebounce } from '@/hooks/use-debounce';
import { useConfirmDialog } from '@/components/common/confirm-dialog';
import { Pagination } from '@/components/common/pagination';

const MAX_TAG_NAME_LENGTH = 50;
const CONVERSATION_PAGE_SIZE = 10;

const PLATFORM_ICONS: Record<CustomerSource, React.ReactNode> = {
  web: <Globe className="w-3.5 h-3.5" />,
  qianniu: <ShoppingBag className="w-3.5 h-3.5" />,
  doudian: <Music className="w-3.5 h-3.5" />,
};

const TAG_COLORS_MAP: Record<string, string> = {
  'VIP': 'bg-amber-100 text-amber-800',
  '新客户': 'bg-blue-200 text-blue-800',
  '退货高频': 'bg-red-100 text-red-800',
  '情绪敏感': 'bg-orange-100 text-orange-800',
  '大额消费': 'bg-purple-100 text-purple-800',
  '重复咨询': 'bg-cyan-100 text-cyan-800',
  '好评客户': 'bg-green-200 text-green-800',
  '投诉风险': 'bg-rose-100 text-rose-800',
};

export default function CustomersPage() {
  const [activeTab, setActiveTab] = useState<'customers' | 'tags'>('customers');
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [tags, setTags] = useState<CustomerTag[]>([]);
  const [searchInput, setSearchInput] = useState('');
  const searchQuery = useDebounce(searchInput, 300);
  const debouncedSearch = searchQuery;
  const [platformFilter, setPlatformFilter] = useState<string>('all');
  const [tagFilter, setTagFilter] = useState<string>('all');
  const [includeAnonymous, setIncludeAnonymous] = useState<boolean>(false);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<{ total: number; byPlatform: Record<string, number> }>({ total: 0, byPlatform: {} });

  // Pagination state
  const pageSize = 20;
  const [currentPage, setCurrentPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const totalPages = Math.ceil(totalCount / pageSize) || 1;

  // Detail drawer
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [customerNotes, setCustomerNotes] = useState('');
  const [customerConversations, setCustomerConversations] = useState<Array<{
    id: string;
    title: string;
    status: string;
    created_at: string;
    message_count?: number;
    rating?: number;
    summary?: string;
  }>>([]);
  // Add new state for load more conversations
  const [conversationOffset, setConversationOffset] = useState(0);
  const [hasMoreConversations, setHasMoreConversations] = useState(false);
  const [conversationsLoading, setConversationsLoading] = useState(false);

  // Conversation detail modal
  const [detailConv, setDetailConv] = useState<{
    id: string;
    title: string;
    rating?: number;
    rating_comment?: string;
  } | null>(null);
  const [detailMessages, setDetailMessages] = useState<Array<{
    id: string;
    role: string;
    content: string;
    created_at: string;
  }>>([]);
  const [detailTotalMessages, setDetailTotalMessages] = useState(0);
  const [detailLoading, setDetailLoading] = useState(false);

  const [promoteForm, setPromoteForm] = useState<{ name: string; phone: string; email: string }>({ name: '', phone: '', email: '' });

  // Tag management modals
  const [createTagModalOpen, setCreateTagModalOpen] = useState(false);
  const [newTag, setNewTag] = useState({ name: '', color: '#2F6BFF', category: 'manual' as 'auto' | 'manual' });
  const [addTagToCustomer, setAddTagToCustomer] = useState(false);

  // Tag detail modal state
  const [tagDetailModalOpen, setTagDetailModalOpen] = useState(false);
  const [editingTag, setEditingTag] = useState<CustomerTag | null>(null);
  const [tagCustomers, setTagCustomers] = useState<Customer[]>([]);
  const [tagCustomerTotal, setTagCustomerTotal] = useState(0);
  const [tagCustomerLoading, setTagCustomerLoading] = useState(false);

  // Tag filter combobox state
  const [tagPopoverOpen, setTagPopoverOpen] = useState(false);

  // Confirm dialog
  const { confirm } = useConfirmDialog();

  // Create customer modal
  const [createCustomerModalOpen, setCreateCustomerModalOpen] = useState(false);
  const [createCustomerForm, setCreateCustomerForm] = useState({
    name: '',
    phone: '',
    email: '',
    source_platform: 'web' as CustomerSource,
    notes: '',
  });
  const [createCustomerLoading, setCreateCustomerLoading] = useState(false);

  // Fetch customers
  const fetchCustomers = useCallback(async (page: number = 1) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (platformFilter !== 'all') params.set('platform', platformFilter);
      if (tagFilter !== 'all') params.set('tag', tagFilter);
      if (searchQuery) params.set('search', searchQuery);
      if (includeAnonymous) params.set('include_anonymous', 'true');
      params.set('page', String(page));
      params.set('pageSize', String(pageSize));

      const res = await fetch(`/api/customers?${params.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      setCustomers(data.customers || []);
      if (data.total !== undefined) setTotalCount(data.total || 0);
      if (data.stats) setStats(data.stats);
    } catch {
      toast.error('获取客户列表失败');
    } finally {
      setLoading(false);
    }
  }, [platformFilter, tagFilter, searchQuery, includeAnonymous, pageSize]);

  // Fetch tags
  const fetchTags = useCallback(async () => {
    try {
      const res = await fetch('/api/customer-tags');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.tags) setTags(data.tags);
    } catch {
      toast.error('获取标签列表失败');
    }
  }, []);

  useEffect(() => {
    setCurrentPage(1);
  }, [platformFilter, tagFilter, searchQuery, includeAnonymous]);

  useEffect(() => {
    fetchCustomers(currentPage);
  }, [currentPage, fetchCustomers]);

  useEffect(() => {
    fetchTags();
  }, [fetchTags]);

  // Open customer detail drawer
  const openCustomerDetail = async (customer: Customer) => {
    setSelectedCustomer(customer);
    setCustomerNotes(customer.notes || '');
    setCustomerConversations([]);
    setConversationOffset(0);
    setHasMoreConversations(false);
    setConversationsLoading(true);
    setDrawerOpen(true);
    // Fetch customer detail with conversations
    try {
      const res = await fetch(`/api/customers/${customer.id}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.conversations) {
        setCustomerConversations(data.conversations);
        setHasMoreConversations(data.conversations.length >= CONVERSATION_PAGE_SIZE);
        setConversationOffset(data.conversations.length);
      }
    } catch {
      setCustomerConversations([]);
    } finally {
      setConversationsLoading(false);
    }
  };

  // Save customer notes
  const saveCustomerNotes = async () => {
    if (!selectedCustomer) return;
    try {
      const res = await fetch(`/api/customers/${selectedCustomer.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: customerNotes }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.customer) {
        toast.success('备注已保存');
        fetchCustomers();
      }
    } catch {
      toast.error('保存失败');
    }
  };

  // Promote anonymous customer to formal (supplement name/phone/email)
  const promoteAnonymousCustomer = async () => {
    if (!selectedCustomer) return;
    if (!promoteForm.name && !promoteForm.phone && !promoteForm.email) {
      toast.error('请至少补充一项信息');
      return;
    }
    try {
      const res = await fetch(`/api/customers/${selectedCustomer.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: promoteForm.name || selectedCustomer.name,
          phone: promoteForm.phone || null,
          email: promoteForm.email || null,
          is_anonymous: false,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.customer) {
        setSelectedCustomer(data.customer);
        setPromoteForm({ name: '', phone: '', email: '' });
        toast.success('已升级为正式客户');

        // 升级后自动添加"新客户"标签（如果存在且尚未添加）
        const newCustomerTag = tags.find(t =>
          t.name === '新客户' && !selectedCustomer.tags.includes('新客户')
        );
        if (newCustomerTag) {
          await handleAddTagToCustomer('新客户');
        }

        fetchCustomers();
      }
    } catch {
      toast.error('升级失败');
    }
  };

  // Add tag to customer
  const handleAddTagToCustomer = async (tagName: string) => {
    if (!selectedCustomer) return;
    const newTags = [...new Set([...selectedCustomer.tags, tagName])];
    try {
      const res = await fetch(`/api/customers/${selectedCustomer.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tags: newTags }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.customer) {
        setSelectedCustomer({ ...selectedCustomer, tags: newTags });
        fetchCustomers();
        toast.success('标签已添加');
      }
    } catch {
      toast.error('添加标签失败');
    }
  };

  // Remove tag from customer
  const handleRemoveTag = async (tagName: string) => {
    if (!selectedCustomer) return;
    const newTags = selectedCustomer.tags.filter(t => t !== tagName);
    try {
      const res = await fetch(`/api/customers/${selectedCustomer.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tags: newTags }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.customer) {
        setSelectedCustomer({ ...selectedCustomer, tags: newTags });
        fetchCustomers();
        toast.success('标签已移除');
      }
    } catch {
      toast.error('移除标签失败');
    }
  };

  // Load more conversations
  const loadMoreConversations = async () => {
    if (!selectedCustomer) return;
    setConversationsLoading(true);
    try {
      const res = await fetch(`/api/customers/${selectedCustomer.id}?offset=${conversationOffset}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.conversations) {
        setCustomerConversations(prev => [...prev, ...data.conversations]);
        setHasMoreConversations(data.conversations.length >= CONVERSATION_PAGE_SIZE);
        setConversationOffset(prev => prev + data.conversations.length);
      }
    } catch {
      toast.error('加载更多对话失败');
    } finally {
      setConversationsLoading(false);
    }
  };

  // Create tag
  const handleCreateTag = async () => {
    if (!newTag.name) {
      toast.error('请输入标签名称');
      return;
    }

    // 检查重名
    if (tags.some(t => t.name.toLowerCase() === newTag.name.toLowerCase())) {
      toast.error('标签名称已存在');
      return;
    }

    // 检查长度
    if (newTag.name.length > MAX_TAG_NAME_LENGTH) {
      toast.error(`标签名称不能超过${MAX_TAG_NAME_LENGTH}个字符`);
      return;
    }

    try {
      const res = await fetch('/api/customer-tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newTag),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.tag) {
        toast.success('标签创建成功');
        setCreateTagModalOpen(false);
        setNewTag({ name: '', color: '#2F6BFF', category: 'manual' });
        setEditingTag(null);
        fetchTags();
      } else {
        toast.error(data.error || '创建失败');
      }
    } catch {
      toast.error('创建标签失败');
    }
  };

  // Update tag
  const handleUpdateTag = async () => {
    if (!editingTag || !newTag.name) {
      toast.error('请输入标签名称');
      return;
    }

    // 检查重名（排除自身）
    if (tags.some(t => t.id !== editingTag.id && t.name.toLowerCase() === newTag.name.toLowerCase())) {
      toast.error('标签名称已存在');
      return;
    }

    // 检查长度
    if (newTag.name.length > MAX_TAG_NAME_LENGTH) {
      toast.error(`标签名称不能超过${MAX_TAG_NAME_LENGTH}个字符`);
      return;
    }

    try {
      const res = await fetch('/api/customer-tags', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editingTag.id,
          name: newTag.name,
          color: newTag.color,
          category: newTag.category,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.tag) {
        toast.success('标签更新成功');
        setCreateTagModalOpen(false);
        setNewTag({ name: '', color: '#2F6BFF', category: 'manual' });
        setEditingTag(null);
        fetchTags();
      } else {
        toast.error(data.error || '更新失败');
      }
    } catch {
      toast.error('更新标签失败');
    }
  };

  // Delete tag
  const handleDeleteTag = async (id: string) => {
    const confirmed = await confirm({
      title: '删除标签',
      description: '确定要删除该标签吗？',
      confirmText: '删除',
      cancelText: '取消',
      destructive: true,
    });
    if (!confirmed) return;
    try {
      const res = await fetch(`/api/customer-tags?id=${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.success) {
        toast.success('标签已删除');
        fetchTags();
      } else {
        toast.error(data.error || '删除失败');
      }
    } catch {
      toast.error('删除失败');
    }
  };

  // Open tag detail modal
  const openTagDetail = async (tag: CustomerTag) => {
    setEditingTag(tag);
    setTagDetailModalOpen(true);
    await fetchTagCustomers(tag.name);
  };

  // Fetch customers by tag
  const fetchTagCustomers = async (tagName: string) => {
    setTagCustomerLoading(true);
    try {
      const res = await fetch(`/api/customers?tag=${encodeURIComponent(tagName)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setTagCustomers(data.customers || []);
      setTagCustomerTotal(data.stats?.byTag?.[tagName] || data.customers?.length || 0);
    } catch {
      toast.error('获取标签客户失败');
      setTagCustomers([]);
      setTagCustomerTotal(0);
    } finally {
      setTagCustomerLoading(false);
    }
  };

  // Open edit tag modal from detail
  const handleEditTag = () => {
    if (!editingTag) return;
    setNewTag({
      name: editingTag.name,
      color: editingTag.color,
      category: editingTag.category,
    });
    setTagDetailModalOpen(false);
    setCreateTagModalOpen(true);
  };

  const formatDate = (date: string) => {
    const d = new Date(date);
    return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  const formatLastSeen = (date: string) => {
    const diff = Date.now() - new Date(date).getTime();
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
    return `${Math.floor(diff / 86400000)} 天前`;
  };

  const availableTagsToAdd = selectedCustomer
    ? tags.filter(t => !selectedCustomer.tags.includes(t.name))
    : [];

  // View conversation detail
  const handleViewConversation = async (conv: {
    id: string;
    title: string;
    rating?: number;
    rating_comment?: string;
  }) => {
    setDetailConv(conv);
    setDetailMessages([]);
    setDetailTotalMessages(0);
    setDetailLoading(true);

    try {
      const res = await fetch(`/api/conversations/${conv.id}?limit=50`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.success) {
        setDetailMessages(data.data?.messages || []);
        setDetailTotalMessages(data.data?.total || data.data?.messages?.length || 0);
      }
    } catch (err) {
      toast.error('加载对话详情失败');
    } finally {
      setDetailLoading(false);
    }
  };

  // Load more messages in detail modal
  const loadMoreMessages = async () => {
    if (!detailConv || detailLoading) return;
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/conversations/${detailConv.id}/messages?limit=50&offset=${detailMessages.length}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.success) {
        setDetailMessages(prev => [...prev, ...(data.data?.messages || [])]);
        setDetailTotalMessages(data.data?.total || detailMessages.length);
      }
    } catch (err) {
      toast.error('加载更多消息失败');
    } finally {
      setDetailLoading(false);
    }
  };

  const closeDrawer = () => {
    setDrawerOpen(false);
    setSelectedCustomer(null);
    setCustomerNotes('');
    setCustomerConversations([]);
    setConversationOffset(0);
    setHasMoreConversations(false);
    setConversationsLoading(false);
    setPromoteForm({ name: '', phone: '', email: '' });
    setAddTagToCustomer(false);
  };

  // Create customer
  const handleCreateCustomer = async () => {
    if (!createCustomerForm.name.trim()) {
      toast.error('请输入客户姓名');
      return;
    }
    if (createCustomerForm.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(createCustomerForm.email)) {
      toast.error('邮箱格式不正确');
      return;
    }
    
    setCreateCustomerLoading(true);
    try {
      const res = await fetch('/api/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: createCustomerForm.name.trim(),
          phone: createCustomerForm.phone || null,
          email: createCustomerForm.email || null,
          source_platform: createCustomerForm.source_platform,
          notes: createCustomerForm.notes || null,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.customer) {
        toast.success('客户创建成功');
        setCreateCustomerModalOpen(false);
        setCreateCustomerForm({ name: '', phone: '', email: '', source_platform: 'web', notes: '' });
        fetchCustomers();
      } else {
        toast.error(data.error || '创建失败');
      }
    } catch {
      toast.error('创建客户失败');
    } finally {
      setCreateCustomerLoading(false);
    }
  };

  // Delete customer
  const handleDeleteCustomer = async () => {
    if (!selectedCustomer) return;
    const confirmed = await confirm({
      title: '删除客户',
      description: '确定要删除该客户吗？此操作不可撤销。',
      confirmText: '删除',
      cancelText: '取消',
      destructive: true,
    });
    if (!confirmed) return;
    try {
      const res = await fetch(`/api/customers?id=${selectedCustomer.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json();
        // 有进行中对话时，提示用户先结束对话
        if (data.code === 'HAS_ACTIVE_CONVERSATIONS' && data.activeConversations?.length > 0) {
          const convList = data.activeConversations
            .map((c: { title: string }) => `• ${c.title}`)
            .join('\n');
          toast.error(
            <div className="text-left">
              <div className="font-semibold mb-1">无法删除：该客户有进行中的对话</div>
              <div className="text-sm opacity-80">请先在对话监控中结束以下对话：</div>
              <div className="text-sm mt-1 whitespace-pre-line">{convList}</div>
            </div>,
            { duration: 5000 }
          );
          return;
        }
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json();
      if (data.success) {
        toast.success('客户已删除');
        closeDrawer();
        fetchCustomers();
      } else {
        toast.error(data.error || '删除失败');
      }
    } catch {
      toast.error('删除客户失败');
    }
  };

  return (
    <div className="flex flex-col h-full min-h-0 page-transition">
      {/* Header */}
      <div className="h-14 px-6 flex items-center border-b border-border bg-card/50 shrink-0">
        <h1 className="text-lg font-semibold text-foreground">客户管理</h1>
      </div>

      {/* Main Content */}
      <div className="flex-1 min-h-0 overflow-auto">
        {/* Tabs */}
        <div className="px-6 pt-4 pb-0">
          <div className="flex gap-1 bg-muted/50 p-1 rounded-lg w-fit">
            <button
              onClick={() => setActiveTab('customers')}
              className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${
                activeTab === 'customers'
                  ? 'bg-card text-foreground shadow-card'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Users className="w-4 h-4" />
              客户列表
            </button>
            <button
              onClick={() => setActiveTab('tags')}
              className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${
                activeTab === 'tags'
                  ? 'bg-card text-foreground shadow-card'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Tag className="w-4 h-4" />
              标签管理
            </button>
          </div>
        </div>

        {/* Customers Tab */}
        {activeTab === 'customers' && (
          <div className="p-6">
            {/* Stats Cards */}
            <div className="grid grid-cols-4 gap-4 mb-6">
              <div className="bg-card rounded-xl p-4 shadow-card">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                    <Users className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <div className="text-2xl font-semibold">{stats.total}</div>
                    <div className="text-sm text-muted-foreground">客户总数</div>
                  </div>
                </div>
              </div>
              <div className="bg-card rounded-xl p-4 shadow-card">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-green-500/10 flex items-center justify-center">
                    <UserCheck className="w-5 h-5 text-green-600" />
                  </div>
                  <div>
                    <div className="text-2xl font-semibold">{(stats.total - (stats.byPlatform?.web || 0)) || 0}</div>
                    <div className="text-sm text-muted-foreground">平台客户</div>
                  </div>
                </div>
              </div>
              <div className="bg-card rounded-xl p-4 shadow-card">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-amber-500/10 flex items-center justify-center">
                    <Clock className="w-5 h-5 text-amber-600" />
                  </div>
                  <div>
                    <div className="text-2xl font-semibold">—</div>
                    <div className="text-sm text-muted-foreground">今日活跃</div>
                  </div>
                </div>
              </div>
              <div className="bg-card rounded-xl p-4 shadow-card">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
                    <MessageSquare className="w-5 h-5 text-blue-600" />
                  </div>
                  <div>
                    <div className="text-2xl font-semibold">—</div>
                    <div className="text-sm text-muted-foreground">总对话数</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Filters */}
            <div className="flex items-center gap-3 mb-4">
              <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="搜索姓名、手机、邮箱..."
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  className="pl-9 pr-9 bg-muted border-none"
                />
                {searchInput && (
                  <button
                    onClick={() => setSearchInput('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
              <Select value={platformFilter} onValueChange={setPlatformFilter}>
                <SelectTrigger className="w-36 bg-muted border-none">
                  <SelectValue placeholder="来源平台" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部平台</SelectItem>
                  <SelectItem value="web">Web</SelectItem>
                  <SelectItem value="qianniu">千牛</SelectItem>
                  <SelectItem value="doudian">抖店</SelectItem>
                </SelectContent>
              </Select>
              {/* 标签筛选：当标签数量超过5个时使用可搜索的 Combobox */}
              {tags.length > 5 ? (
                <Popover open={tagPopoverOpen} onOpenChange={setTagPopoverOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      role="combobox"
                      className="w-36 justify-start bg-muted border-none text-left font-normal"
                    >
                      {tagFilter && tagFilter !== 'all' ? (
                        <span className="truncate">
                          {tags.find((t) => t.name === tagFilter)?.name || tagFilter}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">标签筛选</span>
                      )}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-48 p-0" align="start">
                    <Command>
                      <CommandInput placeholder="搜索标签..." className="h-9" />
                      <CommandList>
                        <CommandEmpty>未找到标签</CommandEmpty>
                        <CommandItem value="all" onSelect={() => { setTagFilter('all'); setTagPopoverOpen(false); }}>
                          全部标签
                        </CommandItem>
                        {tags.map((tag) => (
                          <CommandItem
                            key={tag.id}
                            value={tag.name}
                            onSelect={(currentValue) => {
                              setTagFilter(currentValue);
                              setTagPopoverOpen(false);
                            }}
                          >
                            <div className="flex items-center gap-2">
                              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: tag.color }} />
                              {tag.name}
                            </div>
                          </CommandItem>
                        ))}
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              ) : (
                <Select value={tagFilter} onValueChange={setTagFilter}>
                  <SelectTrigger className="w-36 bg-muted border-none">
                    <SelectValue placeholder="标签筛选" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">全部标签</SelectItem>
                    {tags.map((tag) => (
                      <SelectItem key={tag.id} value={tag.name}>{tag.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={includeAnonymous}
                  onChange={(e) => setIncludeAnonymous(e.target.checked)}
                  className="h-4 w-4 rounded border-border"
                />
                显示匿名访客
              </label>
              <Button size="sm" className="ml-auto gap-2" onClick={() => setCreateCustomerModalOpen(true)}>
                <Plus className="w-4 h-4" />
                添加客户
              </Button>
            </div>

            {/* Customer Cards Grid */}
            <div className="grid grid-cols-1 gap-3">
              {loading ? (
                // Loading skeletons
                Array.from({ length: pageSize }).map((_, i) => (
                  <div key={i} className="bg-card rounded-xl p-4 shadow-card">
                    <div className="flex items-center gap-4">
                      <Skeleton className="w-12 h-12 rounded-full" />
                      <div className="flex-1 space-y-2">
                        <Skeleton className="h-4 w-32" />
                        <Skeleton className="h-3 w-48" />
                      </div>
                      <Skeleton className="h-6 w-20" />
                    </div>
                  </div>
                ))
              ) : customers.length === 0 ? (
                <div className="bg-card rounded-xl p-12 shadow-card text-center animate-fadeIn">
                  <Users className="w-12 h-12 mx-auto text-muted-foreground/50 mb-4" />
                  <div className="text-lg font-medium text-muted-foreground">暂无客户</div>
                  <div className="text-sm text-muted-foreground/70 mt-1">客户数据将显示在这里</div>
                </div>
              ) : (
                customers.map((customer, index) => (
                  <div
                    key={customer.id}
                    className="bg-card rounded-xl p-4 shadow-card hover:shadow-card-hover transition-all cursor-pointer animate-stagger"
                    style={{ animationDelay: `${Math.min(index * 0.04, 0.4)}s` }}
                    onClick={() => openCustomerDetail(customer)}
                  >
                    <div className="flex items-center gap-4">
                      {/* Avatar */}
                      <div className="w-12 h-12 rounded-full bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center text-lg font-semibold text-primary shrink-0">
                        {customer.name?.charAt(0)?.toUpperCase() || '?'}
                      </div>
                      
                      {/* Main Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-semibold text-foreground truncate">{customer.name}</span>
                          {customer.is_anonymous && (
                            <Badge variant="secondary" className="text-xs bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 shrink-0">匿名</Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-4 text-sm text-muted-foreground">
                          {customer.phone && (
                            <div className="flex items-center gap-1">
                              <Phone className="w-3.5 h-3.5" />
                              <span>{customer.phone}</span>
                            </div>
                          )}
                          {customer.email && (
                            <div className="flex items-center gap-1">
                              <Mail className="w-3.5 h-3.5" />
                              <span className="truncate max-w-[150px]">{customer.email}</span>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Platform & Tags */}
                      <div className="flex items-center gap-3 shrink-0">
                        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                          {PLATFORM_ICONS[customer.source_platform]}
                          <span>{SOURCE_PLATFORM_LABELS[customer.source_platform]}</span>
                        </div>
                        
                        {/* Tags */}
                        <div className="flex items-center gap-1.5">
                          {customer.tags.slice(0, 2).map((tagName) => (
                            <Badge
                              key={tagName}
                              className={`${TAG_COLORS_MAP[tagName] || 'bg-muted text-muted-foreground'} text-xs`}
                              variant="secondary"
                            >
                              {tagName}
                            </Badge>
                          ))}
                          {customer.tags.length > 2 && (
                            <Badge variant="secondary" className="bg-muted text-muted-foreground text-xs">
                              +{customer.tags.length - 2}
                            </Badge>
                          )}
                        </div>

                        {/* Stats */}
                        <div className="flex items-center gap-4 text-sm text-muted-foreground pl-3 border-l border-border">
                          <div className="text-center">
                            <div className="font-semibold text-foreground">{customer.conversation_count}</div>
                            <div className="text-xs">对话</div>
                          </div>
                          <div className="text-center">
                            <div className="font-semibold text-foreground">{formatLastSeen(customer.last_seen_at)}</div>
                            <div className="text-xs">最近联系</div>
                          </div>
                        </div>

                        <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground">
                          详情
                          <ChevronRight className="w-3 h-3" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Pagination */}
            {totalCount > pageSize && (
              <Pagination
                page={currentPage}
                totalPages={totalPages}
                total={totalCount}
                pageSize={pageSize}
                onPageChange={(page) => setCurrentPage(page)}
                disabled={loading}
              />
            )}
          </div>
        )}

      {/* Tags Tab */}
      {activeTab === 'tags' && (
        <div className="p-6">
          {/* Tags Header */}
          <div className="flex items-center justify-between mb-6">
            <div>
              <div className="text-sm text-muted-foreground">共 {tags.length} 个标签</div>
            </div>
            <Button onClick={() => setCreateTagModalOpen(true)} className="gap-2">
              <Plus className="w-4 h-4" />
              创建标签
            </Button>
          </div>

          {/* Tags Grid */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {tags.length === 0 ? (
              <div className="col-span-full bg-card rounded-xl p-12 shadow-card text-center animate-fadeIn">
                <Tag className="w-12 h-12 mx-auto text-muted-foreground/50 mb-4" />
                <div className="text-lg font-medium text-muted-foreground">暂无标签</div>
                <div className="text-sm text-muted-foreground/70 mt-1">点击上方按钮创建第一个标签</div>
              </div>
            ) : (
              tags.map((tag, index) => (
                <div
                  key={tag.id}
                  className="bg-card rounded-xl p-4 shadow-card hover:shadow-card-hover transition-all cursor-pointer group animate-stagger"
                  style={{ animationDelay: `${Math.min(index * 0.04, 0.4)}s` }}
                  onClick={() => openTagDetail(tag)}
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <div
                        className="w-4 h-4 rounded-full shadow-sm"
                        style={{ backgroundColor: tag.color }}
                      />
                      <span className="font-medium text-foreground truncate">{tag.name}</span>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity hover:text-destructive"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteTag(tag.id);
                      }}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <Badge variant="secondary" className={tag.category === 'auto' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}>
                      {tag.category === 'auto' ? '自动' : '手动'}
                    </Badge>
                    <span className="text-muted-foreground">{tag.customer_count} 位客户</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
      </div>

      {/* Customer Detail Drawer */}
      {drawerOpen && selectedCustomer && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/30 backdrop-blur-[2px] z-40 transition-opacity animate-fade-in"
            onClick={closeDrawer}
          />
          {/* Drawer */}
          <div className="fixed right-0 top-0 bottom-0 w-[480px] bg-background shadow-float z-50 flex flex-col overflow-hidden animate-slide-in-right">
            {/* Drawer Header */}
            <div className="flex items-center justify-between px-6 h-16 border-b border-border shrink-0 bg-card/80">
              <h2 className="text-lg font-semibold">客户详情</h2>
              <Button variant="ghost" size="icon" onClick={closeDrawer} className="shrink-0">
                <X className="w-4 h-4" />
              </Button>
            </div>

            {/* Drawer Content */}
            <div className="flex-1 overflow-y-auto">
              {/* Customer Header */}
              <div className="px-6 py-5 border-b border-border bg-gradient-to-b from-primary/5 to-transparent">
                <div className="flex items-center gap-4 mb-5">
                  <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center text-2xl font-bold text-white shadow-lg">
                    {selectedCustomer.name?.charAt(0)?.toUpperCase() || '?'}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <div className="text-xl font-bold">{selectedCustomer.name}</div>
                      {selectedCustomer.is_anonymous && (
                        <Badge variant="secondary" className="text-xs bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">匿名访客</Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      {PLATFORM_ICONS[selectedCustomer.source_platform]}
                      <span>{SOURCE_PLATFORM_LABELS[selectedCustomer.source_platform]}</span>
                    </div>
                  </div>
                </div>

                {/* Stats Row */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="bg-card rounded-lg p-3 text-center border">
                    <div className="text-xl font-bold text-foreground">{selectedCustomer.conversation_count}</div>
                    <div className="text-xs text-muted-foreground">对话次数</div>
                  </div>
                  <div className="bg-card rounded-lg p-3 text-center border">
                    <div className="text-xl font-bold text-foreground">{selectedCustomer.tags.length}</div>
                    <div className="text-xs text-muted-foreground">标签数</div>
                  </div>
                  <div className="bg-card rounded-lg p-3 text-center border">
                    <div className="text-xl font-bold text-foreground">{formatLastSeen(selectedCustomer.last_seen_at)}</div>
                    <div className="text-xs text-muted-foreground">最近联系</div>
                  </div>
                </div>
              </div>

              {/* Contact Info */}
              <div className="px-6 py-5 border-b border-border">
                <div className="text-sm font-medium text-muted-foreground mb-3">联系方式</div>
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center">
                      <Phone className="w-4 h-4 text-muted-foreground" />
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">手机号码</div>
                      <div className="font-medium">{selectedCustomer.phone || '-'}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center">
                      <Mail className="w-4 h-4 text-muted-foreground" />
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">电子邮箱</div>
                      <div className="font-medium">{selectedCustomer.email || '-'}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center">
                      <Clock className="w-4 h-4 text-muted-foreground" />
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">首次联系</div>
                      <div className="font-medium">{formatDate(selectedCustomer.first_seen_at)}</div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Tags */}
              <div className="px-6 py-5 border-b border-border">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-medium text-muted-foreground">客户标签</span>
                  <div className="relative">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="gap-1 text-primary h-7"
                      onClick={() => setAddTagToCustomer(!addTagToCustomer)}
                    >
                      <Plus className="w-3.5 h-3.5" />
                      添加
                    </Button>
                    {addTagToCustomer && availableTagsToAdd.length > 0 && (
                      <div className="absolute right-0 top-full mt-1 bg-card border border-border rounded-lg shadow-lg py-1 z-10 w-44">
                        {availableTagsToAdd.map((tag) => (
                          <button
                            key={tag.id}
                            className="w-full text-left px-3 py-2 text-sm hover:bg-muted flex items-center gap-2 transition-colors"
                            onClick={() => { handleAddTagToCustomer(tag.name); setAddTagToCustomer(false); }}
                          >
                            <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: tag.color }} />
                            {tag.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {selectedCustomer.tags.map((tagName) => (
                    <Badge
                      key={tagName}
                      className={`${TAG_COLORS_MAP[tagName] || 'bg-muted text-muted-foreground'} pr-1.5`}
                      variant="secondary"
                    >
                      {tagName}
                      <button
                        className="ml-1 hover:text-destructive transition-colors"
                        onClick={() => handleRemoveTag(tagName)}
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </Badge>
                  ))}
                  {selectedCustomer.tags.length === 0 && (
                    <span className="text-sm text-muted-foreground">暂无标签</span>
                  )}
                </div>
              </div>

              {/* Recent Conversations */}
              <div className="px-6 py-5 border-b border-border">
                <span className="text-sm font-medium text-muted-foreground flex items-center gap-1.5 mb-3">
                  <MessageSquare className="w-4 h-4" />
                  最近对话
                </span>
                {conversationsLoading ? (
                  <div className="space-y-2">
                    {[1, 2, 3].map((i) => (
                      <div key={i} className="p-3 bg-muted/50 rounded-lg animate-pulse">
                        <div className="flex items-center justify-between">
                          <div className="space-y-2">
                            <div className="h-4 w-32 bg-muted rounded" />
                            <div className="h-3 w-48 bg-muted rounded" />
                          </div>
                          <div className="h-5 w-12 bg-muted rounded-full" />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : customerConversations.length === 0 ? (
                  <div className="text-sm text-muted-foreground text-center py-4">暂无对话记录</div>
                ) : (
                  <div className="space-y-2">
                    {customerConversations.map((conv, index) => (
                      <div key={conv.id} className="animate-stagger" style={{ animationDelay: `${index * 0.05}s` }}>
                        <div
                          className="flex items-center justify-between p-3 bg-muted/50 rounded-lg hover:bg-muted transition-colors cursor-pointer"
                          onClick={() => handleViewConversation(conv)}
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-sm font-medium truncate">
                                {conv.title || '对话'}
                              </span>
                              <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${
                                conv.status === 'active' || conv.status === 'handoff'
                                  ? 'bg-primary/10 text-primary'
                                  : 'bg-muted text-muted-foreground'
                              }`}>
                                {conv.status === 'active' || conv.status === 'handoff' ? '进行中' : '已结束'}
                              </span>
                            </div>
                            <div className="flex items-center gap-3 text-xs text-muted-foreground">
                              <span className="flex items-center gap-1">
                                <Calendar className="w-3 h-3" />
                                {formatDate(conv.created_at)}
                              </span>
                              <span className="flex items-center gap-1">
                                <MessageSquare className="w-3 h-3" />
                                {conv.message_count ?? 0} 条消息
                              </span>
                              {conv.rating ? (
                                <span className="flex items-center gap-0.5 text-amber-500">
                                  <Star className="w-3 h-3 fill-amber-400" />
                                  {conv.rating}
                                </span>
                              ) : (
                                <span className="text-muted-foreground/50">未评价</span>
                              )}
                            </div>
                          </div>
                        </div>
                        {/* Expandable Summary */}
                        {(conv.summary || conv.message_count) && (
                          <div className="px-3 pb-2 -mt-1">
                            {conv.summary ? (
                              <p className="text-xs text-muted-foreground/70 line-clamp-2 pl-3 border-l-2 border-muted-foreground/20">
                                {conv.summary}
                              </p>
                            ) : null}
                          </div>
                        )}
                      </div>
                    ))}
                    {hasMoreConversations && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="w-full mt-2"
                        onClick={loadMoreConversations}
                        disabled={conversationsLoading}
                      >
                        {conversationsLoading ? (
                          <>
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            加载中...
                          </>
                        ) : (
                          '加载更多'
                        )}
                      </Button>
                    )}
                  </div>
                )}
              </div>

              {/* Notes */}
              <div className="px-6 py-5">
                <span className="text-sm font-medium text-muted-foreground flex items-center gap-1.5 mb-3">
                  <StickyNote className="w-4 h-4" />
                  客户备注
                </span>
                <Textarea
                  value={customerNotes}
                  onChange={(e) => setCustomerNotes(e.target.value)}
                  placeholder="添加客户备注..."
                  className="bg-muted border-none min-h-[120px] resize-none"
                />
                <div className="flex justify-end mt-2">
                  <Button size="sm" onClick={saveCustomerNotes}>
                    保存备注
                  </Button>
                </div>
              </div>

              {/* Delete Customer */}
              <div className="px-6 py-4">
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full text-destructive hover:text-destructive hover:bg-destructive/10 gap-2"
                  onClick={handleDeleteCustomer}
                >
                  <Trash2 className="w-4 h-4" />
                  删除客户
                </Button>
              </div>

              {/* Promote Anonymous Customer */}
              {selectedCustomer.is_anonymous && (
                <div className="mx-6 mb-6 p-4 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded-xl">
                  <div className="text-sm font-semibold text-amber-900 dark:text-amber-200 mb-2 flex items-center gap-2">
                    <UserCheck className="w-4 h-4" />
                    升级为正式客户
                  </div>
                  <p className="text-xs text-amber-700 dark:text-amber-300 mb-4">
                    补充姓名、手机号或邮箱后，该客户将从匿名访客升级为正式客户。
                  </p>
                  <div className="space-y-2">
                    <Input
                      placeholder="姓名（选填）"
                      value={promoteForm.name}
                      onChange={(e) => setPromoteForm({ ...promoteForm, name: e.target.value })}
                      className="bg-card border-amber-200 dark:border-amber-900"
                    />
                    <Input
                      placeholder="手机（选填）"
                      value={promoteForm.phone}
                      onChange={(e) => setPromoteForm({ ...promoteForm, phone: e.target.value })}
                      className="bg-card border-amber-200 dark:border-amber-900"
                    />
                    <Input
                      placeholder="邮箱（选填）"
                      value={promoteForm.email}
                      onChange={(e) => setPromoteForm({ ...promoteForm, email: e.target.value })}
                      className="bg-card border-amber-200 dark:border-amber-900"
                    />
                    <Button
                      size="sm"
                      onClick={promoteAnonymousCustomer}
                      disabled={!promoteForm.name && !promoteForm.phone && !promoteForm.email}
                      className="w-full bg-amber-600 hover:bg-amber-700 text-white"
                    >
                      升级为正式客户
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* Create Tag Modal */}
      <Dialog open={createTagModalOpen} onOpenChange={(open) => {
        setCreateTagModalOpen(open);
        if (!open) {
          setNewTag({ name: '', color: '#2F6BFF', category: 'manual' });
          setEditingTag(null);
        }
      }}>
        <DialogContent className="sm:max-w-md animate-scale-in">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {editingTag ? (
                <>
                  <Edit3 className="w-5 h-5 text-primary" />
                  编辑标签
                </>
              ) : (
                <>
                  <Tag className="w-5 h-5 text-primary" />
                  创建标签
                </>
              )}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-5 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">标签名称</label>
              <Input
                placeholder="输入标签名称"
                value={newTag.name}
                onChange={(e) => setNewTag({ ...newTag, name: e.target.value })}
                className="bg-muted border-none"
              />
            </div>
            <div className="space-y-3">
              <label className="text-sm font-medium text-foreground flex items-center gap-1.5">
                <Palette className="w-4 h-4" />
                标签颜色
              </label>
              <div className="grid grid-cols-8 gap-2">
                {[
                  { color: '#2F6BFF', name: '蓝色' },
                  { color: '#3B82F6', name: '天蓝' },
                  { color: '#06B6D4', name: '青色' },
                  { color: '#10B981', name: '翠绿' },
                  { color: '#16A37B', name: '薄荷' },
                  { color: '#F59E0B', name: '琥珀' },
                  { color: '#D4A017', name: '金色' },
                  { color: '#EF4444', name: '红色' },
                  { color: '#DC2626', name: '深红' },
                  { color: '#EC4899', name: '粉色' },
                  { color: '#E11D48', name: '玫红' },
                  { color: '#8B5CF6', name: '紫色' },
                  { color: '#A855F7', name: '紫罗兰' },
                  { color: '#F97316', name: '橙色' },
                  { color: '#6366F1', name: '靛蓝' },
                  { color: '#64748B', name: '灰蓝' },
                ].map(({ color, name }) => (
                  <button
                    key={color}
                    title={name}
                    className={`w-8 h-8 rounded-lg transition-all ${
                      newTag.color === color
                        ? 'ring-2 ring-primary ring-offset-2 scale-110'
                        : 'hover:scale-105'
                    }`}
                    style={{ backgroundColor: color }}
                    onClick={() => setNewTag({ ...newTag, color })}
                  />
                ))}
              </div>
              {/* Color Preview */}
              <div className="flex items-center gap-2 p-2 bg-muted/50 rounded-lg">
                <div className="text-xs text-muted-foreground">预览：</div>
                <Badge
                  className="text-white"
                  style={{ backgroundColor: newTag.color }}
                >
                  {newTag.name || '标签名'}
                </Badge>
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">标签类型</label>
              <Select value={newTag.category} onValueChange={(v) => setNewTag({ ...newTag, category: v as 'auto' | 'manual' })}>
                <SelectTrigger className="bg-muted border-none">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="manual">手动标签 - 手动为客户添加</SelectItem>
                  <SelectItem value="auto">自动标签 - 根据规则自动添加</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => {
              setCreateTagModalOpen(false);
              setNewTag({ name: '', color: '#2F6BFF', category: 'manual' });
              setEditingTag(null);
            }}>取消</Button>
            <Button onClick={editingTag ? handleUpdateTag : handleCreateTag}>
              {editingTag ? '保存更改' : '创建标签'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Tag Detail Modal */}
      <Dialog open={tagDetailModalOpen} onOpenChange={(open) => {
        setTagDetailModalOpen(open);
        if (!open) setEditingTag(null);
      }}>
        <DialogContent className="max-w-lg animate-scale-in">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {editingTag && (
                <div
                  className="w-5 h-5 rounded-full shadow-sm"
                  style={{ backgroundColor: editingTag.color }}
                />
              )}
              标签详情
            </DialogTitle>
          </DialogHeader>
          {editingTag && (
            <div className="space-y-4">
              {/* 标签基本信息 */}
              <div className="flex items-center gap-4 p-4 bg-muted/50 rounded-xl">
                <div
                  className="w-12 h-12 rounded-xl flex items-center justify-center text-xl font-bold text-white shadow-md"
                  style={{ backgroundColor: editingTag.color }}
                >
                  {editingTag.name?.charAt(0)?.toUpperCase() || '?'}
                </div>
                <div className="flex-1">
                  <div className="text-lg font-semibold">{editingTag.name}</div>
                  <div className="flex items-center gap-2 mt-1">
                    <Badge variant="secondary" className={editingTag.category === 'auto' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}>
                      {editingTag.category === 'auto' ? '自动标签' : '手动标签'}
                    </Badge>
                    <span className="text-sm text-muted-foreground">{tagCustomerTotal} 位客户</span>
                  </div>
                </div>
              </div>

              {/* 客户列表 */}
              <div>
                <div className="text-sm font-medium text-muted-foreground mb-3">使用该标签的客户</div>
                <div className="max-h-64 overflow-y-auto space-y-2 border border-border rounded-xl p-3">
                  {tagCustomerLoading ? (
                    <div className="space-y-2">
                      {[1, 2, 3].map((i) => (
                        <div key={i} className="flex items-center gap-3 p-2">
                          <Skeleton className="w-8 h-8 rounded-full" />
                          <Skeleton className="h-4 w-24" />
                        </div>
                      ))}
                    </div>
                  ) : tagCustomers.length === 0 ? (
                    <div className="text-sm text-muted-foreground text-center py-8">暂无客户</div>
                  ) : (
                    tagCustomers.map((customer) => (
                      <div 
                        key={customer.id} 
                        className={`flex items-center justify-between p-3 bg-card rounded-lg transition-colors cursor-pointer ${
                          tagCustomerLoading ? 'opacity-50 pointer-events-none' : 'hover:bg-muted/50'
                        }`}
                        onClick={() => {
                          if (tagCustomerLoading) return;
                          setTagDetailModalOpen(false);
                          openCustomerDetail(customer);
                        }}
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center text-sm font-semibold text-primary">
                            {customer.name?.charAt(0)?.toUpperCase() || '?'}
                          </div>
                          <div>
                            <div className="text-sm font-medium">{customer.name}</div>
                            <div className="text-xs text-muted-foreground">{customer.phone || '-'}</div>
                          </div>
                        </div>
                        <ChevronRight className="w-4 h-4 text-muted-foreground" />
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={handleEditTag} className="gap-2">
              <Edit3 className="w-4 h-4" />
              编辑标签
            </Button>
            <Button onClick={() => setTagDetailModalOpen(false)}>关闭</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Customer Modal */}
      <Dialog open={createCustomerModalOpen} onOpenChange={(open) => {
        setCreateCustomerModalOpen(open);
        if (!open) {
          setCreateCustomerForm({ name: '', phone: '', email: '', source_platform: 'web', notes: '' });
        }
      }}>
        <DialogContent className="sm:max-w-md animate-scale-in">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users className="w-5 h-5 text-primary" />
              添加客户
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                客户姓名 <span className="text-destructive">*</span>
              </label>
              <Input
                placeholder="请输入客户姓名"
                value={createCustomerForm.name}
                onChange={(e) => setCreateCustomerForm({ ...createCustomerForm, name: e.target.value })}
                className="bg-muted border-none"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">来源平台</label>
              <Select value={createCustomerForm.source_platform} onValueChange={(v) => setCreateCustomerForm({ ...createCustomerForm, source_platform: v as CustomerSource })}>
                <SelectTrigger className="bg-muted border-none">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="web">Web</SelectItem>
                  <SelectItem value="qianniu">千牛</SelectItem>
                  <SelectItem value="doudian">抖店</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">手机号码</label>
              <Input
                placeholder="请输入手机号码"
                value={createCustomerForm.phone}
                onChange={(e) => setCreateCustomerForm({ ...createCustomerForm, phone: e.target.value })}
                className="bg-muted border-none"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">电子邮箱</label>
              <Input
                placeholder="请输入电子邮箱"
                type="email"
                value={createCustomerForm.email}
                onChange={(e) => setCreateCustomerForm({ ...createCustomerForm, email: e.target.value })}
                className="bg-muted border-none"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">备注</label>
              <Textarea
                placeholder="添加客户备注..."
                value={createCustomerForm.notes}
                onChange={(e) => setCreateCustomerForm({ ...createCustomerForm, notes: e.target.value })}
                className="bg-muted border-none min-h-[80px] resize-none"
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setCreateCustomerModalOpen(false)}>取消</Button>
            <Button onClick={handleCreateCustomer} disabled={createCustomerLoading}>
              {createCustomerLoading ? '创建中...' : '创建客户'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Conversation Detail Modal */}
      {detailConv !== null && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 animate-fadeIn"
          onClick={() => setDetailConv(null)}
        >
          <div
            className="w-full max-w-2xl max-h-[80vh] bg-card rounded-2xl shadow-lg flex flex-col animate-fadeInUp outline-none"
            onClick={(e) => e.stopPropagation()}
            tabIndex={-1}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <h3 className="text-base font-semibold text-foreground">{detailConv.title}</h3>
              <button onClick={() => setDetailConv(null)} className="p-1.5 rounded-lg hover:bg-muted transition-colors" aria-label="关闭">
                <X className="w-4 h-4 text-muted-foreground" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
              {detailLoading ? (
                <div className="flex items-center justify-center h-40">
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                  <span className="ml-2 text-sm text-muted-foreground">加载中...</span>
                </div>
              ) : detailMessages.length > 0 ? (
                <>
                  {/* Load more button at the top */}
                  {detailMessages.length < detailTotalMessages && (
                    <div className="flex justify-center pb-2">
                      <button
                        onClick={loadMoreMessages}
                        disabled={detailLoading}
                        className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground bg-muted/50 hover:bg-muted rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2"
                      >
                        {detailLoading ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <ChevronDown className="w-4 h-4" />
                        )}
                        加载更早消息 ({detailTotalMessages - detailMessages.length} 条)
                      </button>
                    </div>
                  )}
                  {detailMessages.map((msg, idx) => (
                    <div
                      key={msg.id}
                      className={`flex ${msg.role === 'user' ? 'justify-start' : 'justify-end'} animate-slideInRight`}
                      style={{ animationDelay: `${Math.min(idx * 50, 500)}ms` }}
                    >
                      <div
                        className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed transition-all duration-200 hover:shadow-md ${
                          msg.role === 'user'
                            ? 'bg-muted text-foreground'
                            : 'bg-primary text-primary-foreground'
                        }`}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`text-xs font-medium ${
                            msg.role === 'user' ? 'text-muted-foreground' : 'text-primary-foreground/70'
                          }`}>
                            {msg.role === 'user' ? '客户' : msg.role === 'assistant' ? 'AI 客服' : '系统'}
                          </span>
                        </div>
                        {msg.role === 'user' ? msg.content : <MarkdownRenderer content={msg.content || ''} />}
                      </div>
                    </div>
                  ))}
                </>
              ) : (
                <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">
                  暂无消息内容
                </div>
              )}
            </div>
            {detailConv?.rating && (
              <div className="px-6 py-3 border-t border-border flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">满意度：</span>
                <span className="flex items-center gap-0.5 text-amber-500">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Star
                      key={i}
                      className={`w-4 h-4 ${i < detailConv.rating! ? 'fill-amber-400' : 'fill-none'}`}
                    />
                  ))}
                </span>
                {detailConv.rating_comment && (
                  <span className="text-muted-foreground ml-2">— {detailConv.rating_comment}</span>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
