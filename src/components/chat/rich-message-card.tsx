'use client';

import { Package, Truck, RotateCcw, CheckCircle, Clock, MapPin } from 'lucide-react';
import type { RichContent, CardAction } from '@/lib/types';

interface RichMessageCardProps {
  type: string;
  content: RichContent;
  onAction?: (action: CardAction) => void;
}

function str(val: unknown): string {
  return typeof val === 'string' ? val : '';
}

function num(val: unknown): number {
  return typeof val === 'number' ? val : 0;
}

function strArr(val: unknown): Array<{ label: string; action: string; data?: Record<string, unknown> }> {
  if (!Array.isArray(val)) return [];
  return val.map((item: unknown) => {
    const obj = item as Record<string, unknown>;
    return { label: str(obj.label), action: str(obj.action), data: obj.data as Record<string, unknown> | undefined };
  });
}

function stepArr(val: unknown): Array<{ label: string; time: string; completed: boolean }> {
  if (!Array.isArray(val)) return [];
  return val.map((item: unknown) => {
    const obj = item as Record<string, unknown>;
    return { label: str(obj.label), time: str(obj.time), completed: !!obj.completed };
  });
}

export function RichMessageCard({ type, content, onAction }: RichMessageCardProps) {
  const d = content.data as Record<string, unknown>;
  const orderId = str(d.order_id);
  const productName = str(d.product_name);
  const amount = str(d.amount);
  const status = str(d.status);
  const carrier = str(d.carrier);
  const trackingNumber = str(d.tracking_number);
  const estimatedDelivery = str(d.estimated_delivery);
  const refundId = str(d.refund_id);
  const refundAmount = str(d.refund_amount);
  const refundStatus = str(d.refund_status);
  const actions = strArr(d.actions || d.buttons);
  const steps = stepArr(d.steps);
  const description = str(d.description);
  const title = str(d.title);

  if (type === 'order_card' || content.type === 'order') {
    return (
      <div className="bg-background border border-border rounded-lg p-3 min-w-[240px] max-w-[320px]">
        <div className="flex items-center gap-2 mb-2">
          <Package className="w-4 h-4 text-primary" />
          <span className="text-xs font-medium text-primary">订单信息</span>
        </div>
        <div className="space-y-1.5 text-xs">
          <div className="flex justify-between">
            <span className="text-muted-foreground">订单号</span>
            <span className="font-mono text-foreground">{orderId || '-'}</span>
          </div>
          {productName && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">商品</span>
              <span className="text-foreground truncate ml-2 max-w-[180px]">{productName}</span>
            </div>
          )}
          {amount && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">金额</span>
              <span className="text-foreground font-medium">¥{amount}</span>
            </div>
          )}
          {status && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">状态</span>
              <span className="text-primary font-medium">{status}</span>
            </div>
          )}
        </div>
        {actions.length > 0 && (
          <div className="flex gap-2 mt-3 pt-2 border-t border-border/50">
            {actions.map((action, i) => (
              <button
                key={i}
                className="text-xs px-3 py-1 rounded-md bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                onClick={() => onAction?.({
                  type: action.action as CardAction['type'],
                  label: action.label,
                  data: action.data,
                })}
              >
                {action.label}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (type === 'logistics_card' || content.type === 'logistics') {
    return (
      <div className="bg-background border border-border rounded-lg p-3 min-w-[240px] max-w-[320px]">
        <div className="flex items-center gap-2 mb-2">
          <Truck className="w-4 h-4 text-primary" />
          <span className="text-xs font-medium text-primary">物流信息</span>
        </div>
        <div className="space-y-1.5 text-xs mb-3">
          {carrier && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">快递公司</span>
              <span className="text-foreground">{carrier}</span>
            </div>
          )}
          {trackingNumber && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">运单号</span>
              <span className="font-mono text-foreground">{trackingNumber}</span>
            </div>
          )}
          {estimatedDelivery && (
            <div className="flex items-center gap-1">
              <Clock className="w-3 h-3 text-muted-foreground" />
              <span className="text-muted-foreground">预计送达：</span>
              <span className="text-foreground">{estimatedDelivery}</span>
            </div>
          )}
        </div>
        {steps.length > 0 && (
          <div className="border-t border-border/50 pt-2">
            {steps.map((step, i) => (
              <div key={i} className="flex items-start gap-2 pb-2 last:pb-0">
                <div className="flex flex-col items-center mt-0.5">
                  {step.completed ? (
                    <CheckCircle className="w-3.5 h-3.5 text-primary" />
                  ) : (
                    <MapPin className="w-3.5 h-3.5 text-muted-foreground" />
                  )}
                  {i < steps.length - 1 && (
                    <div className={`w-px h-4 ${step.completed ? 'bg-primary/30' : 'bg-border'}`} />
                  )}
                </div>
                <div>
                  <div className={`text-xs ${step.completed ? 'text-foreground' : 'text-muted-foreground'}`}>
                    {step.label}
                  </div>
                  <div className="text-[10px] text-muted-foreground">{step.time}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (type === 'refund_card' || content.type === 'action_buttons') {
    return (
      <div className="bg-background border border-border rounded-lg p-3 min-w-[240px] max-w-[320px]">
        <div className="flex items-center gap-2 mb-2">
          <RotateCcw className="w-4 h-4 text-primary" />
          <span className="text-xs font-medium text-primary">{title || '退款信息'}</span>
        </div>
        {description && (
          <p className="text-xs text-muted-foreground mb-3">{description}</p>
        )}
        <div className="space-y-1.5 text-xs">
          {refundId && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">退款单号</span>
              <span className="font-mono text-foreground">{refundId}</span>
            </div>
          )}
          {orderId && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">原订单号</span>
              <span className="font-mono text-foreground">{orderId}</span>
            </div>
          )}
          {refundAmount && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">退款金额</span>
              <span className="text-foreground font-medium">¥{refundAmount}</span>
            </div>
          )}
          {refundStatus && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">状态</span>
              <span className="text-primary font-medium">{refundStatus}</span>
            </div>
          )}
        </div>
        {actions.length > 0 && (
          <div className="flex gap-2 mt-3 pt-2 border-t border-border/50">
            {actions.map((action, i) => (
              <button
                key={i}
                className={`text-xs px-3 py-1 rounded-md transition-colors ${
                  action.action === 'confirm_refund'
                    ? 'bg-green-100 text-green-700 hover:bg-green-200'
                    : action.action === 'cancel_refund'
                    ? 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    : 'bg-primary/10 text-primary hover:bg-primary/20'
                }`}
                onClick={() => onAction?.({
                  type: action.action as CardAction['type'],
                  label: action.label,
                  data: action.data,
                })}
              >
                {action.label}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  return null;
}
