from coze_coding_dev_sdk.database import Base

from sqlalchemy import BigInteger, Boolean, Column, DateTime, Double, ForeignKeyConstraint, Index, Integer, Numeric, PrimaryKeyConstraint, String, Table, Text, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import JSONB, OID
from typing import Optional
import datetime

from sqlalchemy.orm import Mapped, mapped_column, relationship

class AgentQueue(Base):
    __tablename__ = 'agent_queue'
    __table_args__ = (
        PrimaryKeyConstraint('id', name='agent_queue_pkey'),
        Index('agent_queue_assigned_agent_id_idx', 'assigned_agent_id'),
        Index('agent_queue_created_at_idx', 'created_at'),
        Index('agent_queue_status_idx', 'status')
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, server_default=text('gen_random_uuid()'))
    conversation_id: Mapped[str] = mapped_column(String(36), nullable=False)
    priority: Mapped[str] = mapped_column(String(20), nullable=False, server_default=text("'normal'::character varying"))
    status: Mapped[str] = mapped_column(String(20), nullable=False, server_default=text("'queued'::character varying"))
    created_at: Mapped[datetime.datetime] = mapped_column(DateTime(True), nullable=False, server_default=text('now()'))
    customer_name: Mapped[Optional[str]] = mapped_column(String(100))
    skill_group_id: Mapped[Optional[str]] = mapped_column(String(36))
    assigned_agent_id: Mapped[Optional[str]] = mapped_column(String(36))
    reason: Mapped[Optional[str]] = mapped_column(Text)
    summary: Mapped[Optional[str]] = mapped_column(Text)
    source_platform: Mapped[Optional[str]] = mapped_column(String(20))
    assigned_at: Mapped[Optional[datetime.datetime]] = mapped_column(DateTime(True))
    resolved_at: Mapped[Optional[datetime.datetime]] = mapped_column(DateTime(True))


class AgentSessions(Base):
    __tablename__ = 'agent_sessions'
    __table_args__ = (
        PrimaryKeyConstraint('id', name='agent_sessions_pkey'),
        Index('agent_sessions_status_idx', 'status'),
        Index('agent_sessions_user_id_idx', 'user_id')
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, server_default=text('gen_random_uuid()'))
    user_id: Mapped[str] = mapped_column(String(36), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, server_default=text("'offline'::character varying"))
    last_active_at: Mapped[datetime.datetime] = mapped_column(DateTime(True), nullable=False, server_default=text('now()'))
    created_at: Mapped[datetime.datetime] = mapped_column(DateTime(True), nullable=False, server_default=text('now()'))
    current_conversation_id: Mapped[Optional[str]] = mapped_column(String(36))
    updated_at: Mapped[Optional[datetime.datetime]] = mapped_column(DateTime(True))


class Alerts(Base):
    __tablename__ = 'alerts'
    __table_args__ = (
        PrimaryKeyConstraint('id', name='alerts_pkey'),
        Index('alerts_conversation_id_idx', 'conversation_id'),
        Index('alerts_created_at_idx', 'created_at'),
        Index('alerts_is_resolved_idx', 'is_resolved')
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, server_default=text('gen_random_uuid()'))
    type: Mapped[str] = mapped_column(String(50), nullable=False)
    severity: Mapped[str] = mapped_column(String(20), nullable=False, server_default=text("'warning'::character varying"))
    message: Mapped[str] = mapped_column(Text, nullable=False)
    is_resolved: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text('false'))
    created_at: Mapped[datetime.datetime] = mapped_column(DateTime(True), nullable=False, server_default=text('now()'))
    conversation_id: Mapped[Optional[str]] = mapped_column(String(36))
    metadata_: Mapped[Optional[dict]] = mapped_column('metadata', JSONB)
    resolved_at: Mapped[Optional[datetime.datetime]] = mapped_column(DateTime(True))


class AutoReplyRules(Base):
    __tablename__ = 'auto_reply_rules'
    __table_args__ = (
        PrimaryKeyConstraint('id', name='auto_reply_rules_pkey'),
        Index('auto_reply_rules_enabled_idx', 'is_enabled')
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, server_default=text('gen_random_uuid()'))
    keyword: Mapped[str] = mapped_column(String(255), nullable=False)
    match_mode: Mapped[str] = mapped_column(String(20), nullable=False, server_default=text("'fuzzy'::character varying"))
    reply_content: Mapped[str] = mapped_column(Text, nullable=False)
    is_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text('true'))
    priority: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text('0'))
    created_at: Mapped[datetime.datetime] = mapped_column(DateTime(True), nullable=False, server_default=text('now()'))
    updated_at: Mapped[Optional[datetime.datetime]] = mapped_column(DateTime(True))


class BotConfigs(Base):
    __tablename__ = 'bot_configs'
    __table_args__ = (
        PrimaryKeyConstraint('id', name='bot_configs_pkey'),
        UniqueConstraint('name', name='bot_configs_name_key'),
        Index('bot_configs_is_default_idx', 'is_default'),
        Index('bot_configs_is_sub_agent_idx', 'is_sub_agent'),
        Index('bot_configs_parent_bot_id_idx', 'parent_bot_id')
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, server_default=text('gen_random_uuid()'))
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    system_prompt: Mapped[str] = mapped_column(Text, nullable=False)
    tools: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default=text("'[]'::jsonb"))
    knowledge_ids: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default=text("'[]'::jsonb"))
    is_default: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text('false'))
    created_at: Mapped[datetime.datetime] = mapped_column(DateTime(True), nullable=False, server_default=text('now()'))
    is_sub_agent: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text('false'))
    status: Mapped[str] = mapped_column(String(20), nullable=False, server_default=text("'active'::character varying"))
    description: Mapped[Optional[str]] = mapped_column(Text)
    skill_group_id: Mapped[Optional[str]] = mapped_column(String(36))
    updated_at: Mapped[Optional[datetime.datetime]] = mapped_column(DateTime(True))
    parent_bot_id: Mapped[Optional[str]] = mapped_column(String(36))
    delegation_prompt: Mapped[Optional[str]] = mapped_column(Text)
    collaboration_config: Mapped[Optional[dict]] = mapped_column(JSONB, server_default=text("'{}'::jsonb"))

    marketing_campaigns: Mapped[list['MarketingCampaigns']] = relationship('MarketingCampaigns', back_populates='bot')
    routing_rules: Mapped[list['RoutingRules']] = relationship('RoutingRules', back_populates='target_bot')


class ConversationTagRecords(Base):
    __tablename__ = 'conversation_tag_records'
    __table_args__ = (
        PrimaryKeyConstraint('id', name='conversation_tag_records_pkey'),
        Index('conversation_tag_records_conversation_id_idx', 'conversation_id'),
        Index('conversation_tag_records_tag_id_idx', 'tag_id')
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, server_default=text('gen_random_uuid()'))
    conversation_id: Mapped[str] = mapped_column(String(36), nullable=False)
    tag_id: Mapped[str] = mapped_column(String(36), nullable=False)
    created_at: Mapped[datetime.datetime] = mapped_column(DateTime(True), nullable=False, server_default=text('now()'))
    tagged_by: Mapped[Optional[str]] = mapped_column(String(36))


class ConversationTagsDef(Base):
    __tablename__ = 'conversation_tags_def'
    __table_args__ = (
        PrimaryKeyConstraint('id', name='conversation_tags_def_pkey'),
        UniqueConstraint('name', name='conversation_tags_def_name_key'),
        Index('conversation_tags_def_category_idx', 'category')
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, server_default=text('gen_random_uuid()'))
    name: Mapped[str] = mapped_column(String(50), nullable=False)
    color: Mapped[str] = mapped_column(String(20), nullable=False, server_default=text("'#2F6BFF'::character varying"))
    category: Mapped[str] = mapped_column(String(20), nullable=False, server_default=text("'question_type'::character varying"))
    conversation_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text('0'))
    created_at: Mapped[datetime.datetime] = mapped_column(DateTime(True), nullable=False, server_default=text('now()'))
    updated_at: Mapped[Optional[datetime.datetime]] = mapped_column(DateTime(True))


class Conversations(Base):
    __tablename__ = 'conversations'
    __table_args__ = (
        PrimaryKeyConstraint('id', name='conversations_pkey'),
        Index('conversations_created_at_idx', 'created_at'),
        Index('conversations_status_idx', 'status')
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, server_default=text('gen_random_uuid()'))
    title: Mapped[str] = mapped_column(String(255), nullable=False, server_default=text("'新对话'::character varying"))
    status: Mapped[str] = mapped_column(String(20), nullable=False, server_default=text("'active'::character varying"))
    message_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text('0'))
    source: Mapped[str] = mapped_column(String(20), nullable=False, server_default=text("'web'::character varying"))
    priority: Mapped[str] = mapped_column(String(20), nullable=False, server_default=text("'normal'::character varying"))
    unread_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text('0'))
    created_at: Mapped[datetime.datetime] = mapped_column(DateTime(True), nullable=False, server_default=text('now()'))
    rating: Mapped[Optional[int]] = mapped_column(Integer)
    rating_comment: Mapped[Optional[str]] = mapped_column(Text)
    platform_connection_id: Mapped[Optional[str]] = mapped_column(String(36))
    external_user_id: Mapped[Optional[str]] = mapped_column(String(255))
    external_session_id: Mapped[Optional[str]] = mapped_column(String(255))
    handoff_reason: Mapped[Optional[str]] = mapped_column(Text)
    assigned_agent: Mapped[Optional[str]] = mapped_column(String(100))
    summary: Mapped[Optional[str]] = mapped_column(Text)
    updated_at: Mapped[Optional[datetime.datetime]] = mapped_column(DateTime(True))

    agent_delegations: Mapped[list['AgentDelegations']] = relationship('AgentDelegations', back_populates='conversation')
    messages: Mapped[list['Messages']] = relationship('Messages', back_populates='conversation')
    agent_collaborations: Mapped[list['AgentCollaborations']] = relationship('AgentCollaborations', back_populates='conversation')


class CustomerConversations(Base):
    __tablename__ = 'customer_conversations'
    __table_args__ = (
        PrimaryKeyConstraint('id', name='customer_conversations_pkey'),
        Index('customer_conversations_conversation_id_idx', 'conversation_id'),
        Index('customer_conversations_customer_id_idx', 'customer_id')
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, server_default=text('gen_random_uuid()'))
    customer_id: Mapped[str] = mapped_column(String(36), nullable=False)
    conversation_id: Mapped[str] = mapped_column(String(36), nullable=False)
    created_at: Mapped[datetime.datetime] = mapped_column(DateTime(True), nullable=False, server_default=text('now()'))


class CustomerTags(Base):
    __tablename__ = 'customer_tags'
    __table_args__ = (
        PrimaryKeyConstraint('id', name='customer_tags_pkey'),
        UniqueConstraint('name', name='customer_tags_name_key'),
        Index('customer_tags_category_idx', 'category')
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, server_default=text('gen_random_uuid()'))
    name: Mapped[str] = mapped_column(String(50), nullable=False)
    color: Mapped[str] = mapped_column(String(20), nullable=False, server_default=text("'#2F6BFF'::character varying"))
    category: Mapped[str] = mapped_column(String(20), nullable=False, server_default=text("'manual'::character varying"))
    is_system: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text('false'))
    customer_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text('0'))
    created_at: Mapped[datetime.datetime] = mapped_column(DateTime(True), nullable=False, server_default=text('now()'))
    updated_at: Mapped[Optional[datetime.datetime]] = mapped_column(DateTime(True))


class Customers(Base):
    __tablename__ = 'customers'
    __table_args__ = (
        PrimaryKeyConstraint('id', name='customers_pkey'),
        Index('customers_external_id_idx', 'external_id'),
        Index('customers_last_seen_at_idx', 'last_seen_at'),
        Index('customers_source_platform_idx', 'source_platform'),
        Index('customers_platform_connection_id_idx', 'platform_connection_id')
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, server_default=text('gen_random_uuid()'))
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    source_platform: Mapped[str] = mapped_column(String(20), nullable=False, server_default=text("'web'::character varying"))
    tags: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default=text("'[]'::jsonb"))
    conversation_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text('0'))
    is_anonymous: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text('false'))
    platform_connection_id: Mapped[Optional[str]] = mapped_column(String(36))
    first_seen_at: Mapped[datetime.datetime] = mapped_column(DateTime(True), nullable=False, server_default=text('now()'))
    last_seen_at: Mapped[datetime.datetime] = mapped_column(DateTime(True), nullable=False, server_default=text('now()'))
    created_at: Mapped[datetime.datetime] = mapped_column(DateTime(True), nullable=False, server_default=text('now()'))
    phone: Mapped[Optional[str]] = mapped_column(String(20))
    email: Mapped[Optional[str]] = mapped_column(String(255))
    avatar: Mapped[Optional[str]] = mapped_column(Text)
    external_id: Mapped[Optional[str]] = mapped_column(String(255))
    metadata_: Mapped[Optional[dict]] = mapped_column('metadata', JSONB)
    notes: Mapped[Optional[str]] = mapped_column(Text)
    updated_at: Mapped[Optional[datetime.datetime]] = mapped_column(DateTime(True))


class HealthCheck(Base):
    __tablename__ = 'health_check'
    __table_args__ = (
        PrimaryKeyConstraint('id', name='health_check_pkey'),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    updated_at: Mapped[Optional[datetime.datetime]] = mapped_column(DateTime(True), server_default=text('now()'))


class KnowledgeItems(Base):
    __tablename__ = 'knowledge_items'
    __table_args__ = (
        PrimaryKeyConstraint('id', name='knowledge_items_pkey'),
        Index('knowledge_items_category_idx', 'category'),
        Index('knowledge_items_status_idx', 'status')
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, server_default=text('gen_random_uuid()'))
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    type: Mapped[str] = mapped_column(String(20), nullable=False, server_default=text("'text'::character varying"))
    status: Mapped[str] = mapped_column(String(20), nullable=False, server_default=text("'active'::character varying"))
    created_at: Mapped[datetime.datetime] = mapped_column(DateTime(True), nullable=False, server_default=text('now()'))
    content: Mapped[Optional[str]] = mapped_column(Text)
    doc_ids: Mapped[Optional[dict]] = mapped_column(JSONB)
    category: Mapped[Optional[str]] = mapped_column(String(100), server_default=text("'未分类'::character varying"))
    chunk_count: Mapped[Optional[int]] = mapped_column(Integer, server_default=text('0'))
    updated_at: Mapped[Optional[datetime.datetime]] = mapped_column(DateTime(True))


class KnowledgeLearningQueue(Base):
    __tablename__ = 'knowledge_learning_queue'
    __table_args__ = (
        PrimaryKeyConstraint('id', name='knowledge_learning_queue_pkey'),
        Index('klq_confidence_idx', 'confidence'),
        Index('klq_conversation_id_idx', 'conversation_id'),
        Index('klq_created_at_idx', 'created_at'),
        Index('klq_status_idx', 'status')
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, server_default=text('gen_random_uuid()'))
    question: Mapped[str] = mapped_column(Text, nullable=False)
    answer: Mapped[str] = mapped_column(Text, nullable=False)
    confidence: Mapped[float] = mapped_column(Double(53), nullable=False, server_default=text('0'))
    status: Mapped[str] = mapped_column(String(20), nullable=False, server_default=text("'pending'::character varying"))
    created_at: Mapped[datetime.datetime] = mapped_column(DateTime(True), nullable=False, server_default=text('now()'))
    conversation_id: Mapped[Optional[str]] = mapped_column(String(36))
    conversation_title: Mapped[Optional[str]] = mapped_column(String(255))
    source_context: Mapped[Optional[str]] = mapped_column(Text)
    category: Mapped[Optional[str]] = mapped_column(String(100), server_default=text("'未分类'::character varying"))
    reviewed_by: Mapped[Optional[str]] = mapped_column(String(100))
    reviewed_at: Mapped[Optional[datetime.datetime]] = mapped_column(DateTime(True))
    knowledge_item_id: Mapped[Optional[str]] = mapped_column(String(36))
    updated_at: Mapped[Optional[datetime.datetime]] = mapped_column(DateTime(True))


class KnowledgeVersions(Base):
    __tablename__ = 'knowledge_versions'
    __table_args__ = (
        PrimaryKeyConstraint('id', name='knowledge_versions_pkey'),
        Index('knowledge_versions_item_id_idx', 'item_id')
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, server_default=text('gen_random_uuid()'))
    item_id: Mapped[str] = mapped_column(String(36), nullable=False)
    version_number: Mapped[int] = mapped_column(Integer, nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime.datetime] = mapped_column(DateTime(True), nullable=False, server_default=text('now()'))
    change_summary: Mapped[Optional[str]] = mapped_column(Text)
    created_by: Mapped[Optional[str]] = mapped_column(String(100))


t_pg_stat_statements = Table(
    'pg_stat_statements', Base.metadata,
    Column('userid', OID),
    Column('dbid', OID),
    Column('toplevel', Boolean),
    Column('queryid', BigInteger),
    Column('query', Text),
    Column('plans', BigInteger),
    Column('total_plan_time', Double(53)),
    Column('min_plan_time', Double(53)),
    Column('max_plan_time', Double(53)),
    Column('mean_plan_time', Double(53)),
    Column('stddev_plan_time', Double(53)),
    Column('calls', BigInteger),
    Column('total_exec_time', Double(53)),
    Column('min_exec_time', Double(53)),
    Column('max_exec_time', Double(53)),
    Column('mean_exec_time', Double(53)),
    Column('stddev_exec_time', Double(53)),
    Column('rows', BigInteger),
    Column('shared_blks_hit', BigInteger),
    Column('shared_blks_read', BigInteger),
    Column('shared_blks_dirtied', BigInteger),
    Column('shared_blks_written', BigInteger),
    Column('local_blks_hit', BigInteger),
    Column('local_blks_read', BigInteger),
    Column('local_blks_dirtied', BigInteger),
    Column('local_blks_written', BigInteger),
    Column('temp_blks_read', BigInteger),
    Column('temp_blks_written', BigInteger),
    Column('shared_blk_read_time', Double(53)),
    Column('shared_blk_write_time', Double(53)),
    Column('local_blk_read_time', Double(53)),
    Column('local_blk_write_time', Double(53)),
    Column('temp_blk_read_time', Double(53)),
    Column('temp_blk_write_time', Double(53)),
    Column('wal_records', BigInteger),
    Column('wal_fpi', BigInteger),
    Column('wal_bytes', Numeric),
    Column('jit_functions', BigInteger),
    Column('jit_generation_time', Double(53)),
    Column('jit_inlining_count', BigInteger),
    Column('jit_inlining_time', Double(53)),
    Column('jit_optimization_count', BigInteger),
    Column('jit_optimization_time', Double(53)),
    Column('jit_emission_count', BigInteger),
    Column('jit_emission_time', Double(53)),
    Column('jit_deform_count', BigInteger),
    Column('jit_deform_time', Double(53)),
    Column('stats_since', DateTime(True)),
    Column('minmax_stats_since', DateTime(True))
)


t_pg_stat_statements_info = Table(
    'pg_stat_statements_info', Base.metadata,
    Column('dealloc', BigInteger),
    Column('stats_reset', DateTime(True))
)


class PlatformConnections(Base):
    __tablename__ = 'platform_connections'
    __table_args__ = (
        PrimaryKeyConstraint('id', name='platform_connections_pkey'),
        Index('platform_connections_platform_idx', 'platform'),
        Index('platform_connections_status_idx', 'status')
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, server_default=text('gen_random_uuid()'))
    platform: Mapped[str] = mapped_column(String(50), nullable=False)
    app_key: Mapped[str] = mapped_column(String(100), nullable=False)
    app_secret: Mapped[str] = mapped_column(String(200), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, server_default=text("'disconnected'::character varying"))
    created_at: Mapped[datetime.datetime] = mapped_column(DateTime(True), nullable=False, server_default=text('now()'))
    access_token: Mapped[Optional[str]] = mapped_column(Text)
    refresh_token: Mapped[Optional[str]] = mapped_column(Text)
    token_expires_at: Mapped[Optional[datetime.datetime]] = mapped_column(DateTime(True))
    shop_name: Mapped[Optional[str]] = mapped_column(String(255))
    shop_id: Mapped[Optional[str]] = mapped_column(String(100))
    webhook_url: Mapped[Optional[str]] = mapped_column(Text)
    config: Mapped[Optional[dict]] = mapped_column(JSONB)
    updated_at: Mapped[Optional[datetime.datetime]] = mapped_column(DateTime(True))


class PushEventLog(Base):
    __tablename__ = 'push_event_log'
    __table_args__ = (
        PrimaryKeyConstraint('id', name='push_event_log_pkey'),
        Index('push_event_log_created_at_idx', 'created_at'),
        Index('push_event_log_event_type_idx', 'event_type'),
        Index('push_event_log_processed_idx', 'processed')
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, server_default=text('gen_random_uuid()'))
    event_type: Mapped[str] = mapped_column(String(50), nullable=False)
    processed: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text('false'))
    created_at: Mapped[datetime.datetime] = mapped_column(DateTime(True), nullable=False, server_default=text('now()'))
    event_data: Mapped[Optional[dict]] = mapped_column(JSONB)
    processed_at: Mapped[Optional[datetime.datetime]] = mapped_column(DateTime(True))
    error_message: Mapped[Optional[str]] = mapped_column(Text)
    webhook_secret: Mapped[Optional[str]] = mapped_column(String(100))


class PushRecords(Base):
    __tablename__ = 'push_records'
    __table_args__ = (
        PrimaryKeyConstraint('id', name='push_records_pkey'),
        Index('push_records_sent_at_idx', 'sent_at'),
        Index('push_records_status_idx', 'status'),
        Index('push_records_template_id_idx', 'template_id')
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, server_default=text('gen_random_uuid()'))
    content: Mapped[str] = mapped_column(Text, nullable=False)
    channel: Mapped[str] = mapped_column(String(20), nullable=False, server_default=text("'in_app'::character varying"))
    status: Mapped[str] = mapped_column(String(20), nullable=False, server_default=text("'pending'::character varying"))
    sent_at: Mapped[datetime.datetime] = mapped_column(DateTime(True), nullable=False, server_default=text('now()'))
    template_id: Mapped[Optional[str]] = mapped_column(String(36))
    recipient_id: Mapped[Optional[str]] = mapped_column(String(36))
    trigger_event: Mapped[Optional[str]] = mapped_column(String(50))
    delivered_at: Mapped[Optional[datetime.datetime]] = mapped_column(DateTime(True))
    read_at: Mapped[Optional[datetime.datetime]] = mapped_column(DateTime(True))


class PushTemplates(Base):
    __tablename__ = 'push_templates'
    __table_args__ = (
        PrimaryKeyConstraint('id', name='push_templates_pkey'),
        Index('push_templates_is_enabled_idx', 'is_enabled'),
        Index('push_templates_trigger_event_idx', 'trigger_event')
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, server_default=text('gen_random_uuid()'))
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    trigger_event: Mapped[str] = mapped_column(String(50), nullable=False)
    content_template: Mapped[str] = mapped_column(Text, nullable=False)
    channel: Mapped[str] = mapped_column(String(20), nullable=False, server_default=text("'in_app'::character varying"))
    is_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text('true'))
    created_at: Mapped[datetime.datetime] = mapped_column(DateTime(True), nullable=False, server_default=text('now()'))
    updated_at: Mapped[Optional[datetime.datetime]] = mapped_column(DateTime(True))


class QualityChecks(Base):
    __tablename__ = 'quality_checks'
    __table_args__ = (
        PrimaryKeyConstraint('id', name='quality_checks_pkey'),
        Index('quality_checks_conversation_id_idx', 'conversation_id'),
        Index('quality_checks_rule_id_idx', 'rule_id')
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, server_default=text('gen_random_uuid()'))
    conversation_id: Mapped[str] = mapped_column(String(36), nullable=False)
    rule_id: Mapped[str] = mapped_column(String(36), nullable=False)
    result: Mapped[str] = mapped_column(String(20), nullable=False, server_default=text("'pending'::character varying"))
    created_at: Mapped[datetime.datetime] = mapped_column(DateTime(True), nullable=False, server_default=text('now()'))
    details: Mapped[Optional[dict]] = mapped_column(JSONB)
    checked_by: Mapped[Optional[str]] = mapped_column(String(36))


class QualityRules(Base):
    __tablename__ = 'quality_rules'
    __table_args__ = (
        PrimaryKeyConstraint('id', name='quality_rules_pkey'),
        Index('quality_rules_is_enabled_idx', 'is_enabled'),
        Index('quality_rules_type_idx', 'type')
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, server_default=text('gen_random_uuid()'))
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    type: Mapped[str] = mapped_column(String(30), nullable=False, server_default=text("'first_response_timeout'::character varying"))
    config: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default=text("'{}'::jsonb"))
    is_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text('true'))
    created_at: Mapped[datetime.datetime] = mapped_column(DateTime(True), nullable=False, server_default=text('now()'))
    updated_at: Mapped[Optional[datetime.datetime]] = mapped_column(DateTime(True))


class QuickReplies(Base):
    __tablename__ = 'quick_replies'
    __table_args__ = (
        PrimaryKeyConstraint('id', name='quick_replies_pkey'),
        Index('quick_replies_category_idx', 'category'),
        Index('quick_replies_scope_idx', 'scope')
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, server_default=text('gen_random_uuid()'))
    title: Mapped[str] = mapped_column(String(100), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    category: Mapped[str] = mapped_column(String(50), nullable=False, server_default=text("'通用'::character varying"))
    variables: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default=text("'[]'::jsonb"))
    scope: Mapped[str] = mapped_column(String(20), nullable=False, server_default=text("'global'::character varying"))
    usage_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text('0'))
    created_at: Mapped[datetime.datetime] = mapped_column(DateTime(True), nullable=False, server_default=text('now()'))
    creator_id: Mapped[Optional[str]] = mapped_column(String(36))
    updated_at: Mapped[Optional[datetime.datetime]] = mapped_column(DateTime(True))


class RolePermissions(Base):
    __tablename__ = 'role_permissions'
    __table_args__ = (
        PrimaryKeyConstraint('id', name='role_permissions_pkey'),
        Index('role_permissions_resource_idx', 'resource'),
        Index('role_permissions_role_idx', 'role')
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, server_default=text('gen_random_uuid()'))
    role: Mapped[str] = mapped_column(String(20), nullable=False)
    resource: Mapped[str] = mapped_column(String(50), nullable=False)
    action: Mapped[str] = mapped_column(String(20), nullable=False)
    allowed: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text('false'))
    created_at: Mapped[datetime.datetime] = mapped_column(DateTime(True), nullable=False, server_default=text('now()'))
    updated_at: Mapped[Optional[datetime.datetime]] = mapped_column(DateTime(True))


class Settings(Base):
    __tablename__ = 'settings'
    __table_args__ = (
        PrimaryKeyConstraint('id', name='settings_pkey'),
        UniqueConstraint('key', name='settings_key_key'),
        Index('settings_key_idx', 'key')
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, server_default=text('gen_random_uuid()'))
    key: Mapped[str] = mapped_column(String(100), nullable=False)
    value: Mapped[str] = mapped_column(Text, nullable=False)
    updated_at: Mapped[Optional[datetime.datetime]] = mapped_column(DateTime(True), server_default=text('now()'))


class SkillGroups(Base):
    __tablename__ = 'skill_groups'
    __table_args__ = (
        PrimaryKeyConstraint('id', name='skill_groups_pkey'),
        UniqueConstraint('name', name='skill_groups_name_key')
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, server_default=text('gen_random_uuid()'))
    name: Mapped[str] = mapped_column(String(50), nullable=False)
    member_ids: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default=text("'[]'::jsonb"))
    is_default: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text('false'))
    created_at: Mapped[datetime.datetime] = mapped_column(DateTime(True), nullable=False, server_default=text('now()'))
    description: Mapped[Optional[str]] = mapped_column(Text)
    updated_at: Mapped[Optional[datetime.datetime]] = mapped_column(DateTime(True))


class TicketComments(Base):
    __tablename__ = 'ticket_comments'
    __table_args__ = (
        PrimaryKeyConstraint('id', name='ticket_comments_pkey'),
        Index('ticket_comments_ticket_id_idx', 'ticket_id')
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, server_default=text('gen_random_uuid()'))
    ticket_id: Mapped[str] = mapped_column(String(36), nullable=False)
    author_id: Mapped[str] = mapped_column(String(36), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    is_internal: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text('false'))
    created_at: Mapped[datetime.datetime] = mapped_column(DateTime(True), nullable=False, server_default=text('now()'))


class TicketStatusLog(Base):
    __tablename__ = 'ticket_status_log'
    __table_args__ = (
        PrimaryKeyConstraint('id', name='ticket_status_log_pkey'),
        Index('ticket_status_log_ticket_id_idx', 'ticket_id')
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, server_default=text('gen_random_uuid()'))
    ticket_id: Mapped[str] = mapped_column(String(36), nullable=False)
    to_status: Mapped[str] = mapped_column(String(20), nullable=False)
    created_at: Mapped[datetime.datetime] = mapped_column(DateTime(True), nullable=False, server_default=text('now()'))
    from_status: Mapped[Optional[str]] = mapped_column(String(20))
    operator_id: Mapped[Optional[str]] = mapped_column(String(36))
    comment: Mapped[Optional[str]] = mapped_column(Text)


class Tickets(Base):
    __tablename__ = 'tickets'
    __table_args__ = (
        PrimaryKeyConstraint('id', name='tickets_pkey'),
        UniqueConstraint('ticket_number', name='tickets_ticket_number_key'),
        Index('tickets_assignee_id_idx', 'assignee_id'),
        Index('tickets_created_at_idx', 'created_at'),
        Index('tickets_priority_idx', 'priority'),
        Index('tickets_status_idx', 'status')
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, server_default=text('gen_random_uuid()'))
    ticket_number: Mapped[str] = mapped_column(String(20), nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    priority: Mapped[str] = mapped_column(String(20), nullable=False, server_default=text("'medium'::character varying"))
    status: Mapped[str] = mapped_column(String(20), nullable=False, server_default=text("'open'::character varying"))
    creator_id: Mapped[str] = mapped_column(String(36), nullable=False)
    created_at: Mapped[datetime.datetime] = mapped_column(DateTime(True), nullable=False, server_default=text('now()'))
    description: Mapped[Optional[str]] = mapped_column(Text)
    category: Mapped[Optional[str]] = mapped_column(String(50), server_default=text("'general'::character varying"))
    assignee_id: Mapped[Optional[str]] = mapped_column(String(36))
    conversation_id: Mapped[Optional[str]] = mapped_column(String(36))
    updated_at: Mapped[Optional[datetime.datetime]] = mapped_column(DateTime(True))
    resolved_at: Mapped[Optional[datetime.datetime]] = mapped_column(DateTime(True))


class Users(Base):
    __tablename__ = 'users'
    __table_args__ = (
        PrimaryKeyConstraint('id', name='users_pkey'),
        UniqueConstraint('email', name='users_email_key'),
        Index('users_email_idx', 'email'),
        Index('users_role_idx', 'role'),
        Index('users_status_idx', 'status')
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, server_default=text('gen_random_uuid()'))
    email: Mapped[str] = mapped_column(String(255), nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    role: Mapped[str] = mapped_column(String(20), nullable=False, server_default=text("'agent'::character varying"))
    status: Mapped[str] = mapped_column(String(20), nullable=False, server_default=text("'active'::character varying"))
    created_at: Mapped[datetime.datetime] = mapped_column(DateTime(True), nullable=False, server_default=text('now()'))
    avatar: Mapped[Optional[str]] = mapped_column(Text)
    last_active_at: Mapped[Optional[datetime.datetime]] = mapped_column(DateTime(True))
    updated_at: Mapped[Optional[datetime.datetime]] = mapped_column(DateTime(True))


class AgentDelegations(Base):
    __tablename__ = 'agent_delegations'
    __table_args__ = (
        ForeignKeyConstraint(['conversation_id'], ['conversations.id'], ondelete='CASCADE', name='agent_delegations_conversation_id_fkey'),
        PrimaryKeyConstraint('id', name='agent_delegations_pkey'),
        Index('agent_delegations_child_bot_id_idx', 'child_bot_id'),
        Index('agent_delegations_conversation_id_idx', 'conversation_id'),
        Index('agent_delegations_parent_bot_id_idx', 'parent_bot_id'),
        Index('agent_delegations_status_idx', 'status')
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, server_default=text('gen_random_uuid()'))
    conversation_id: Mapped[str] = mapped_column(String(36), nullable=False)
    parent_bot_id: Mapped[str] = mapped_column(String(36), nullable=False)
    child_bot_id: Mapped[str] = mapped_column(String(36), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, server_default=text("'pending'::character varying"))
    created_at: Mapped[datetime.datetime] = mapped_column(DateTime(True), nullable=False, server_default=text('now()'))
    trigger_intent: Mapped[Optional[str]] = mapped_column(String(100))
    input_message: Mapped[Optional[str]] = mapped_column(Text)
    result_content: Mapped[Optional[str]] = mapped_column(Text)
    confidence: Mapped[Optional[float]] = mapped_column(Double(53))
    error_message: Mapped[Optional[str]] = mapped_column(Text)
    metadata_: Mapped[Optional[dict]] = mapped_column('metadata', JSONB)
    completed_at: Mapped[Optional[datetime.datetime]] = mapped_column(DateTime(True))

    conversation: Mapped['Conversations'] = relationship('Conversations', back_populates='agent_delegations')
    agent_collaborations: Mapped[list['AgentCollaborations']] = relationship('AgentCollaborations', back_populates='delegation')


class MarketingCampaigns(Base):
    __tablename__ = 'marketing_campaigns'
    __table_args__ = (
        ForeignKeyConstraint(['bot_id'], ['bot_configs.id'], ondelete='SET NULL', name='marketing_campaigns_bot_id_fkey'),
        PrimaryKeyConstraint('id', name='marketing_campaigns_pkey'),
        Index('marketing_campaigns_status_idx', 'status'),
        Index('marketing_campaigns_type_idx', 'type')
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, server_default=text('gen_random_uuid()'))
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    type: Mapped[str] = mapped_column(String(30), nullable=False, server_default=text("'abandoned_cart'::character varying"))
    target_segment: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default=text("'{}'::jsonb"))
    status: Mapped[str] = mapped_column(String(20), nullable=False, server_default=text("'draft'::character varying"))
    created_at: Mapped[datetime.datetime] = mapped_column(DateTime(True), nullable=False, server_default=text('now()'))
    bot_id: Mapped[Optional[str]] = mapped_column(String(36))
    ab_variants: Mapped[Optional[dict]] = mapped_column(JSONB)
    updated_at: Mapped[Optional[datetime.datetime]] = mapped_column(DateTime(True))

    bot: Mapped[Optional['BotConfigs']] = relationship('BotConfigs', back_populates='marketing_campaigns')
    marketing_logs: Mapped[list['MarketingLogs']] = relationship('MarketingLogs', back_populates='campaign')


class Messages(Base):
    __tablename__ = 'messages'
    __table_args__ = (
        ForeignKeyConstraint(['conversation_id'], ['conversations.id'], ondelete='CASCADE', name='messages_conversation_id_fkey'),
        PrimaryKeyConstraint('id', name='messages_pkey'),
        Index('messages_conversation_id_idx', 'conversation_id'),
        Index('messages_created_at_idx', 'created_at')
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, server_default=text('gen_random_uuid()'))
    conversation_id: Mapped[str] = mapped_column(String(36), nullable=False)
    role: Mapped[str] = mapped_column(String(20), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    message_type: Mapped[str] = mapped_column(String(20), nullable=False, server_default=text("'text'::character varying"))
    created_at: Mapped[datetime.datetime] = mapped_column(DateTime(True), nullable=False, server_default=text('now()'))
    sources: Mapped[Optional[dict]] = mapped_column(JSONB)
    confidence: Mapped[Optional[float]] = mapped_column(Double(53))
    tool_calls: Mapped[Optional[dict]] = mapped_column(JSONB)
    tool_results: Mapped[Optional[dict]] = mapped_column(JSONB)
    image_url: Mapped[Optional[str]] = mapped_column(Text)
    rich_content: Mapped[Optional[dict]] = mapped_column(JSONB)

    conversation: Mapped['Conversations'] = relationship('Conversations', back_populates='messages')


class RoutingRules(Base):
    __tablename__ = 'routing_rules'
    __table_args__ = (
        ForeignKeyConstraint(['target_bot_id'], ['bot_configs.id'], ondelete='CASCADE', name='routing_rules_target_bot_id_fkey'),
        PrimaryKeyConstraint('id', name='routing_rules_pkey'),
        Index('routing_rules_condition_type_idx', 'condition_type'),
        Index('routing_rules_is_enabled_idx', 'is_enabled')
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, server_default=text('gen_random_uuid()'))
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    condition_type: Mapped[str] = mapped_column(String(30), nullable=False, server_default=text("'keyword'::character varying"))
    condition_config: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default=text("'{}'::jsonb"))
    target_bot_id: Mapped[str] = mapped_column(String(36), nullable=False)
    priority: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text('0'))
    is_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text('true'))
    created_at: Mapped[datetime.datetime] = mapped_column(DateTime(True), nullable=False, server_default=text('now()'))
    updated_at: Mapped[Optional[datetime.datetime]] = mapped_column(DateTime(True))

    target_bot: Mapped['BotConfigs'] = relationship('BotConfigs', back_populates='routing_rules')


class AgentCollaborations(Base):
    __tablename__ = 'agent_collaborations'
    __table_args__ = (
        ForeignKeyConstraint(['conversation_id'], ['conversations.id'], ondelete='CASCADE', name='agent_collaborations_conversation_id_fkey'),
        ForeignKeyConstraint(['delegation_id'], ['agent_delegations.id'], ondelete='CASCADE', name='agent_collaborations_delegation_id_fkey'),
        PrimaryKeyConstraint('id', name='agent_collaborations_pkey'),
        Index('agent_collaborations_conversation_id_idx', 'conversation_id'),
        Index('agent_collaborations_delegation_id_idx', 'delegation_id'),
        Index('agent_collaborations_receiver_bot_id_idx', 'receiver_bot_id'),
        Index('agent_collaborations_sender_bot_id_idx', 'sender_bot_id')
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, server_default=text('gen_random_uuid()'))
    conversation_id: Mapped[str] = mapped_column(String(36), nullable=False)
    sender_bot_id: Mapped[str] = mapped_column(String(36), nullable=False)
    receiver_bot_id: Mapped[str] = mapped_column(String(36), nullable=False)
    message_type: Mapped[str] = mapped_column(String(30), nullable=False, server_default=text("'request'::character varying"))
    content: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, server_default=text("'sent'::character varying"))
    created_at: Mapped[datetime.datetime] = mapped_column(DateTime(True), nullable=False, server_default=text('now()'))
    delegation_id: Mapped[Optional[str]] = mapped_column(String(36))
    context: Mapped[Optional[dict]] = mapped_column(JSONB)

    conversation: Mapped['Conversations'] = relationship('Conversations', back_populates='agent_collaborations')
    delegation: Mapped[Optional['AgentDelegations']] = relationship('AgentDelegations', back_populates='agent_collaborations')


class MarketingLogs(Base):
    __tablename__ = 'marketing_logs'
    __table_args__ = (
        ForeignKeyConstraint(['campaign_id'], ['marketing_campaigns.id'], ondelete='CASCADE', name='marketing_logs_campaign_id_fkey'),
        PrimaryKeyConstraint('id', name='marketing_logs_pkey'),
        Index('marketing_logs_campaign_id_idx', 'campaign_id'),
        Index('marketing_logs_customer_id_idx', 'customer_id')
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, server_default=text('gen_random_uuid()'))
    campaign_id: Mapped[str] = mapped_column(String(36), nullable=False)
    sent_at: Mapped[datetime.datetime] = mapped_column(DateTime(True), nullable=False, server_default=text('now()'))
    opened: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text('false'))
    replied: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text('false'))
    converted: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text('false'))
    customer_id: Mapped[Optional[str]] = mapped_column(String(36))
    conversation_id: Mapped[Optional[str]] = mapped_column(String(36))
    variant: Mapped[Optional[str]] = mapped_column(String(10))

    campaign: Mapped['MarketingCampaigns'] = relationship('MarketingCampaigns', back_populates='marketing_logs')
