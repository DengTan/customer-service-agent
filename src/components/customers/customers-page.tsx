'use client';

import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import {
  Search, Plus, X, Tag, Users, Globe, ShoppingBag, Music,
  Edit3, Trash2, ChevronRight, MessageSquare, StickyNote, Palette,
} from 'lucide-react';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import type { Customer, CustomerTag, CustomerSource } from '@/lib/types';
import { SOURCE_PLATFORM_LABELS } from '@/lib/types';
import { useDebounce } from '@/hooks/use-debounce';

const PLATFORM_ICONS: Record<CustomerSource, React.ReactNode> = {
  web: <Globe className="w-3.5 h-3.5" />,
  qianniu: <ShoppingBag className="w-3.5 h-3.5" />,
  doudian: <Music className="w-3.5 h-3.5" />,
};

const TAG_COLORS_MAP: Record<string, string> = {
  'VIP': 'bg-amber-100 text-amber-800',
  '新客户': 'bg-blue-100 text-blue-800',
  '退货高频': 'bg-red-100 text-red-800',
  '情绪敏感': 'bg-orange-100 text-orange-800',
  '大额消费': 'bg-purple-100 text-purple-800',
  '重复咨询': 'bg-cyan-100 text-cyan-800',
  '好评客户': 'bg-green-100 text-green-800',
  '投诉风险': 'bg-rose-100 text-rose-800',
};

export default function CustomersPage() {
  const [activeTab, setActiveTab] = useState<'customers' | 'tags'>('customers');
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [tags, setTags] = useState<CustomerTag[]>([]);
  const [searchInput, setSearchInput] = useState('');
  const searchQuery = useDebounce(searchInput, 300);
  const [platformFilter, setPlatformFilter] = useState<string>('all');
  const [tagFilter, setTagFilter] = useState<string>('all');
  const [includeAnonymous, setIncludeAnonymous] = useState<boolean>(false);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<{ total: number; byPlatform: Record<string, number> }>({ total: 0, byPlatform: {} });

  // Detail drawer
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [customerNotes, setCustomerNotes] = useState('');
  const [customerConversations, setCustomerConversations] = useState<Array<{ id: string; title: string; status: string; created_at: string }>>([]);
  // Add new state for load more conversations
  const [conversationOffset, setConversationOffset] = useState(0);
  const [hasMoreConversations, setHasMoreConversations] = useState(false);

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

  // Fetch customers
  const fetchCustomers = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (platformFilter !== 'all') params.set('platform', platformFilter);
      if (tagFilter !== 'all') params.set('tag', tagFilter);
      if (searchQuery) params.set('search', searchQuery);
      if (includeAnonymous) params.set('include_anonymous', 'true');
      const res = await fetch(`/api/customers?${params.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.customers) setCustomers(data.customers);
      if (data.stats) setStats(data.stats);
    } catch {
      toast.error('获取客户列表失败');
    } finally {
      setLoading(false);
    }
  }, [platformFilter, tagFilter, searchQuery, includeAnonymous]);

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
    fetchCustomers();
  }, [fetchCustomers]);

  useEffect(() => {
    fetchTags();
  }, [fetchTags]);

  // Open customer detail drawer
  const openCustomerDetail = async (customer: Customer) => {
    setSelectedCustomer(customer);
    setCustomerNotes(customer.notes || '');
    setDrawerOpen(true);
    // Fetch customer detail with conversations
    try {
      const res = await fetch(`/api/customers/${customer.id}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.conversations) {
        setCustomerConversations(data.conversations);
        setHasMoreConversations(data.conversations.length >= 10);
        setConversationOffset(data.conversations.length);
      }
    } catch {
      setCustomerConversations([]);
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
    try {
      const res = await fetch(`/api/customers/${selectedCustomer.id}?offset=${conversationOffset}`);
      const data = await res.json();
      if (data.conversations) {
        setCustomerConversations(prev => [...prev, ...data.conversations]);
        setHasMoreConversations(data.conversations.length >= 10);
        setConversationOffset(prev => prev + data.conversations.length);
      }
    } catch {
      toast.error('加载更多对话失败');
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
    if (newTag.name.length > 50) {
      toast.error('标签名称不能超过50个字符');
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
    if (newTag.name.length > 50) {
      toast.error('标签名称不能超过50个字符');
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
    if (!confirm('确定要删除该标签吗？')) return;
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
      const data = await res.json();
      setTagCustomers(data.customers || []);
      setTagCustomerTotal(data.stats?.byTag?.[tagName] || data.customers?.length || 0);
    } catch {
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

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="h-14 px-6 flex items-center justify-between border-b border-border bg-card/50 shrink-0">
        <div>
          <h1 className="text-lg font-semibold text-foreground">客户管理</h1>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 min-h-0 flex flex-col p-6">
        {/* Tabs */}
        <div className="flex gap-1 mb-6 bg-muted/50 p-1 rounded-lg w-fit">
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

      {/* Customers Tab */}
      {activeTab === 'customers' && (
        <div className="flex-1 min-h-0 flex flex-col">
          {/* Filters */}
          <div className="flex items-center gap-3 mb-4">
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="搜索姓名、手机、邮箱..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="pl-9 bg-muted border-none"
              />
            </div>
            <Select value={platformFilter} onValueChange={setPlatformFilter}>
              <SelectTrigger className="w-32 bg-muted border-none">
                <SelectValue placeholder="来源平台" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部平台</SelectItem>
                <SelectItem value="web">Web</SelectItem>
                <SelectItem value="qianniu">千牛</SelectItem>
                <SelectItem value="doudian">抖店</SelectItem>
              </SelectContent>
            </Select>
            <Select value={tagFilter} onValueChange={setTagFilter}>
              <SelectTrigger className="w-32 bg-muted border-none">
                <SelectValue placeholder="标签筛选" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部标签</SelectItem>
                {tags.map((tag) => (
                  <SelectItem key={tag.id} value={tag.name}>{tag.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer select-none">
              <input
                type="checkbox"
                checked={includeAnonymous}
                onChange={(e) => setIncludeAnonymous(e.target.checked)}
                className="h-4 w-4 rounded border-border"
              />
              显示匿名访客
            </label>
          </div>

          {/* Stats */}
          <div className="flex gap-4 mb-4 text-sm">
            <span className="text-muted-foreground">客户总数 <span className="font-semibold text-foreground">{stats.total}</span></span>
            <span className="text-muted-foreground">Web <span className="font-semibold text-foreground">{stats.byPlatform?.web || 0}</span></span>
            <span className="text-muted-foreground">千牛 <span className="font-semibold text-foreground">{stats.byPlatform?.qianniu || 0}</span></span>
            <span className="text-muted-foreground">抖店 <span className="font-semibold text-foreground">{stats.byPlatform?.doudian || 0}</span></span>
          </div>

          {/* Table */}
          <div className="flex-1 min-h-0 overflow-auto bg-card rounded-lg shadow-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>客户</TableHead>
                  <TableHead>手机号</TableHead>
                  <TableHead>来源</TableHead>
                  <TableHead>标签</TableHead>
                  <TableHead>对话数</TableHead>
                  <TableHead>最后联系</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">加载中...</TableCell>
                  </TableRow>
                ) : customers.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">暂无客户</TableCell>
                  </TableRow>
                ) : (
                  customers.map((customer) => (
                    <TableRow
                      key={customer.id}
                      className="cursor-pointer hover:bg-muted/30"
                      onClick={() => openCustomerDetail(customer)}
                    >
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-sm font-medium text-primary">
                            {customer.name.charAt(0)}
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{customer.name}</span>
                            {customer.is_anonymous && (
                              <Badge variant="secondary" className="text-xs bg-muted text-muted-foreground">匿名</Badge>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">{customer.phone || '-'}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5 text-sm">
                          {PLATFORM_ICONS[customer.source_platform]}
                          <span>{SOURCE_PLATFORM_LABELS[customer.source_platform]}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {customer.tags.slice(0, 3).map((tagName) => (
                            <Badge
                              key={tagName}
                              className={TAG_COLORS_MAP[tagName] || 'bg-muted text-muted-foreground'}
                              variant="secondary"
                            >
                              {tagName}
                            </Badge>
                          ))}
                          {customer.tags.length > 3 && (
                            <Badge variant="secondary" className="bg-muted text-muted-foreground">
                              +{customer.tags.length - 3}
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">{customer.conversation_count}</TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {formatLastSeen(customer.last_seen_at)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="gap-1"
                          onClick={(e) => { e.stopPropagation(); openCustomerDetail(customer); }}
                        >
                          详情
                          <ChevronRight className="w-3 h-3" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {/* Tags Tab */}
      {activeTab === 'tags' && (
        <div className="flex-1 min-h-0 flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <span className="text-sm text-muted-foreground">共 {tags.length} 个标签</span>
            <Button onClick={() => setCreateTagModalOpen(true)} className="gap-2">
              <Plus className="w-4 h-4" />
              创建标签
            </Button>
          </div>

          <div className="flex-1 min-h-0 overflow-auto">
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {tags.map((tag) => (
                <div
                  key={tag.id}
                  className="bg-card rounded-lg shadow-card p-4 flex flex-col gap-3 cursor-pointer hover:shadow-md transition-shadow"
                  onClick={() => openTagDetail(tag)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: tag.color }}
                      />
                      <span className="font-medium">{tag.name}</span>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
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
              ))}
            </div>
          </div>
        </div>
      )}
      </div>

      {/* Customer Detail Drawer */}
      {drawerOpen && selectedCustomer && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/30 z-40"
            onClick={() => setDrawerOpen(false)}
          />
          {/* Drawer */}
          <div className="fixed right-0 top-0 bottom-0 w-[420px] bg-card shadow-float z-50 flex flex-col overflow-y-auto">
            {/* Drawer Header */}
            <div className="flex items-center justify-between p-6 border-b border-border">
              <h2 className="text-lg font-semibold">客户详情</h2>
              <Button variant="ghost" size="icon" onClick={() => setDrawerOpen(false)}>
                <X className="w-4 h-4" />
              </Button>
            </div>

            {/* Customer Info */}
            <div className="p-6 border-b border-border">
              <div className="flex items-center gap-4 mb-4">
                <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center text-xl font-semibold text-primary">
                  {selectedCustomer.name.charAt(0)}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <div className="text-lg font-semibold">{selectedCustomer.name}</div>
                    {selectedCustomer.is_anonymous && (
                      <Badge variant="secondary" className="text-xs bg-muted text-muted-foreground">匿名访客</Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                    {PLATFORM_ICONS[selectedCustomer.source_platform]}
                    {SOURCE_PLATFORM_LABELS[selectedCustomer.source_platform]}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="text-muted-foreground">手机</span>
                  <div className="font-medium mt-0.5">{selectedCustomer.phone || '-'}</div>
                </div>
                <div>
                  <span className="text-muted-foreground">邮箱</span>
                  <div className="font-medium mt-0.5">{selectedCustomer.email || '-'}</div>
                </div>
                <div>
                  <span className="text-muted-foreground">首次联系</span>
                  <div className="font-medium mt-0.5">{formatDate(selectedCustomer.first_seen_at)}</div>
                </div>
                <div>
                  <span className="text-muted-foreground">最后联系</span>
                  <div className="font-medium mt-0.5">{formatLastSeen(selectedCustomer.last_seen_at)}</div>
                </div>
                <div>
                  <span className="text-muted-foreground">对话次数</span>
                  <div className="font-medium mt-0.5">{selectedCustomer.conversation_count}</div>
                </div>
              </div>
            </div>

            {/* Tags */}
            <div className="p-6 border-b border-border">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium">标签</span>
                <div className="relative">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="gap-1 text-primary"
                    onClick={() => setAddTagToCustomer(!addTagToCustomer)}
                  >
                    <Plus className="w-3.5 h-3.5" />
                    添加标签
                  </Button>
                  {addTagToCustomer && availableTagsToAdd.length > 0 && (
                    <div className="absolute right-0 top-full mt-1 bg-card border border-border rounded-lg shadow-float py-1 z-10 w-40">
                      {availableTagsToAdd.map((tag) => (
                        <button
                          key={tag.id}
                          className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted flex items-center gap-2"
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
                    className={`${TAG_COLORS_MAP[tagName] || 'bg-muted text-muted-foreground'} pr-1`}
                    variant="secondary"
                  >
                    {tagName}
                    <button
                      className="ml-1 hover:text-destructive"
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
            <div className="p-6 border-b border-border">
              <span className="text-sm font-medium flex items-center gap-1.5 mb-3">
                <MessageSquare className="w-4 h-4" />
                最近对话
              </span>
              {customerConversations.length === 0 ? (
                <span className="text-sm text-muted-foreground">暂无对话记录</span>
              ) : (
                <div className="space-y-2">
                  {customerConversations.map((conv) => (
                    <div key={conv.id} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                      <div>
                        <div className="text-sm font-medium">{conv.title || '对话'}</div>
                        <div className="text-xs text-muted-foreground">{formatDate(conv.created_at)}</div>
                      </div>
                      <Badge variant="secondary" className={conv.status === 'completed' ? 'bg-success/10 text-success' : 'bg-primary/10 text-primary'}>
                        {conv.status === 'completed' ? '已解决' : '进行中'}
                      </Badge>
                    </div>
                  ))}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full mt-2"
                    onClick={loadMoreConversations}
                    disabled={!hasMoreConversations}
                  >
                    {hasMoreConversations ? '加载更多' : '已加载全部'}
                  </Button>
                </div>
              )}
            </div>

            {/* Notes */}
            <div className="p-6">
              <span className="text-sm font-medium flex items-center gap-1.5 mb-3">
                <StickyNote className="w-4 h-4" />
                客户备注
              </span>
              <Textarea
                value={customerNotes}
                onChange={(e) => setCustomerNotes(e.target.value)}
                placeholder="添加客户备注..."
                className="bg-muted border-none min-h-[100px] resize-none"
              />
              <Button size="sm" className="mt-2" onClick={saveCustomerNotes}>
                保存备注
              </Button>
            </div>

            {/* Promote Anonymous Customer */}
            {selectedCustomer.is_anonymous && (
              <div className="mt-6 p-4 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded-lg">
                <div className="text-sm font-medium text-amber-900 dark:text-amber-200 mb-2">
                  升级为正式客户
                </div>
                <p className="text-xs text-amber-700 dark:text-amber-300 mb-3">
                  补充姓名、手机号或邮箱后，该客户将从匿名访客列表中升级为正式客户。
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
                    className="w-full"
                  >
                    升级为正式客户
                  </Button>
                </div>
              </div>
            )}
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
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingTag ? '编辑标签' : '创建标签'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">标签名称</label>
              <Input
                placeholder="输入标签名称"
                value={newTag.name}
                onChange={(e) => setNewTag({ ...newTag, name: e.target.value })}
                className="bg-muted border-none"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium flex items-center gap-1.5">
                <Palette className="w-4 h-4" />
                颜色
              </label>
              <div className="flex gap-2">
                {['#2F6BFF', '#DC2626', '#F97316', '#D4A017', '#16A37B', '#8B5CF6', '#06B6D4', '#E11D48'].map((color) => (
                  <button
                    key={color}
                    className={`w-8 h-8 rounded-full transition-all ${
                      newTag.color === color ? 'ring-2 ring-primary ring-offset-2' : ''
                    }`}
                    style={{ backgroundColor: color }}
                    onClick={() => setNewTag({ ...newTag, color })}
                  />
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">分类</label>
              <Select value={newTag.category} onValueChange={(v) => setNewTag({ ...newTag, category: v as 'auto' | 'manual' })}>
                <SelectTrigger className="bg-muted border-none">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="manual">手动标签</SelectItem>
                  <SelectItem value="auto">自动标签</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => {
              setCreateTagModalOpen(false);
              setNewTag({ name: '', color: '#2F6BFF', category: 'manual' });
              setEditingTag(null);
            }}>取消</Button>
            <Button onClick={editingTag ? handleUpdateTag : handleCreateTag}>{editingTag ? '保存' : '创建'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Tag Detail Modal */}
      <Dialog open={tagDetailModalOpen} onOpenChange={(open) => {
        setTagDetailModalOpen(open);
        if (!open) setEditingTag(null);
      }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>标签详情</DialogTitle>
          </DialogHeader>
          {editingTag && (
            <div className="space-y-4">
              {/* 标签基本信息 */}
              <div className="flex items-center gap-3 p-4 bg-muted/50 rounded-lg">
                <div
                  className="w-6 h-6 rounded-full flex-shrink-0"
                  style={{ backgroundColor: editingTag.color }}
                />
                <span className="text-lg font-medium">{editingTag.name}</span>
                <Badge variant="secondary" className={editingTag.category === 'auto' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}>
                  {editingTag.category === 'auto' ? '自动' : '手动'}
                </Badge>
              </div>

              {/* 客户列表 */}
              <div>
                <div className="text-sm font-medium mb-2 flex items-center gap-2">
                  使用该标签的客户
                  {!tagCustomerLoading && (
                    <Badge variant="secondary">{tagCustomerTotal}</Badge>
                  )}
                </div>
                <div className="max-h-60 overflow-y-auto space-y-2 border border-border rounded-lg p-3">
                  {tagCustomerLoading ? (
                    <div className="text-sm text-muted-foreground text-center py-4">加载中...</div>
                  ) : tagCustomers.length === 0 ? (
                    <div className="text-sm text-muted-foreground text-center py-4">暂无客户</div>
                  ) : (
                    tagCustomers.map((customer) => (
                      <div key={customer.id} className="flex items-center justify-between p-2 bg-muted/30 rounded hover:bg-muted/50">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-xs font-medium text-primary">
                            {customer.name.charAt(0)}
                          </div>
                          <span className="text-sm font-medium">{customer.name}</span>
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {customer.phone || '-'}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={handleEditTag}>
              <Edit3 className="w-4 h-4 mr-1" />
              编辑
            </Button>
            <Button onClick={() => setTagDetailModalOpen(false)}>关闭</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
