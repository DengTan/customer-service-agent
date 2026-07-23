import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ 缺少 Supabase 配置');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false }
});

const DEFAULT_QUICK_REPLIES = [
  // ==================== 售前咨询 ====================
  {
    title: '产品介绍开场白',
    content: '您好！欢迎光临我们的店铺～我是您的专属客服，很高兴为您服务！请问有什么可以帮到您的呢？',
    category: '售前咨询',
    scope: 'global',
    usage_count: 0,
  },
  {
    title: '产品推荐',
    content: '根据您的需求，我为您推荐这款产品。它有以下亮点：\n1. 品质优良\n2. 性价比高\n3. 销量领先\n\n您看看是否满意呢？',
    category: '售前咨询',
    scope: 'global',
    usage_count: 0,
  },
  {
    title: '尺码咨询回复',
    content: '您好，关于尺码选择，建议您根据以下信息选择：\n1. 如果您平时穿标准尺码，按正常尺码选购即可\n2. 如果您体型偏胖或偏瘦，建议选大一码/小一码\n3. 商品详情页有详细的尺码表和试穿报告，可以参考一下哦～',
    category: '售前咨询',
    scope: 'global',
    usage_count: 0,
  },
  {
    title: '价格优惠咨询',
    content: '您好！我们店铺目前有以下优惠活动：\n1. 新客首单立减10元\n2. 满200减30，满300减50\n3. 会员专享9折优惠\n\n您可以看看有哪些适合您的～',
    category: '售前咨询',
    scope: 'global',
    usage_count: 0,
  },
  {
    title: '库存确认',
    content: '您好，我来帮您查询一下这款产品的库存情况，请稍等～\n\n查询结果：目前库存{库存数量}件，着急的话可以尽快下单哦！',
    category: '售前咨询',
    scope: 'global',
    usage_count: 0,
  },

  // ==================== 售后问题 ====================
  {
    title: '退换货政策说明',
    content: '您好，关于退换货政策请参考以下说明：\n\n【退货】签收后7天内可申请退货，需保证商品全新未使用，包装完整\n【换货】签收后15天内可申请换货，换同款或同系列其他尺码/颜色\n【运费】因质量问题退换货由我们承担运费，其他原因由买家承担\n\n请问您是想退换货吗？我来帮您处理～',
    category: '售后问题',
    scope: 'global',
    usage_count: 0,
  },
  {
    title: '退款进度查询',
    content: '您好，我帮您查询一下退款进度：\n\n退款金额：{退款金额}元\n退款方式：{退款方式}\n预计到账时间：提交退款后3-7个工作日\n\n请您耐心等待退款到账哦～如有其他问题随时联系我！',
    category: '售后问题',
    scope: 'global',
    usage_count: 0,
  },
  {
    title: '质量问题处理',
    content: '非常抱歉给您带来了不好的体验！关于您反馈的质量问题，我们非常重视。\n\n为了更好地为您处理，请提供：\n1. 商品存在问题的照片\n2. 订单编号\n\n收到后我们会第一时间为您处理，可以选择退货退款或重新发货～',
    category: '售后问题',
    scope: 'global',
    usage_count: 0,
  },
  {
    title: '错发漏发处理',
    content: '非常抱歉是我们工作的失误！🙏\n\n请您提供：\n1. 收到的商品照片\n2. 订单编号\n\n我们会立刻为您补发正确商品，并安排取回错发的商品。给您带来不便深表歉意！',
    category: '售后问题',
    scope: 'global',
    usage_count: 0,
  },
  {
    title: '七天无理由退货',
    content: '您好，支持七天无理由退货哦！退货须知：\n\n1. 商品需保持全新未使用状态\n2. 包装、配件、说明书等需完整\n3. 退货运费由买家承担（质量问题我们承担）\n4. 请在签收后7天内联系我们申请退货\n\n请问需要我帮您申请退货吗？',
    category: '售后问题',
    scope: 'global',
    usage_count: 0,
  },

  // ==================== 物流咨询 ====================
  {
    title: '发货时间说明',
    content: '您好！关于发货时间：\n\n1. 【现货商品】付款后48小时内发货\n2. 【预售商品】按商品页面标注的发货时间为准\n3. 【节假日】可能会有1-2天延迟，还请谅解\n\n订单支付成功后，我们会尽快为您安排发货的～',
    category: '物流咨询',
    scope: 'global',
    usage_count: 0,
  },
  {
    title: '物流查询',
    content: '您好，我帮您查询一下物流信息：\n\n快递公司：{快递公司}\n运单号码：{运单号码}\n当前状态：{物流状态}\n\n您也可以通过以下链接自主查询：\n{物流查询链接}\n\n如有其他问题随时联系我～',
    category: '物流咨询',
    scope: 'global',
    usage_count: 0,
  },
  {
    title: '物流延迟说明',
    content: '非常抱歉给您带来不便！近期物流压力较大，部分地区可能出现延迟：\n\n1. 预计延迟1-3天左右\n2. 我们会持续跟进物流进度\n3. 如长时间未收到，请联系我们协助催件\n\n感谢您的耐心等待！🙏',
    category: '物流咨询',
    scope: 'global',
    usage_count: 0,
  },
  {
    title: '修改收货地址',
    content: '您好，关于修改收货地址：\n\n如果订单尚未发货，我们可以帮您修改地址；\n如果订单已发货，需要等到收件后再拒收重新下单哦～\n\n请问您的订单目前是什么状态呢？',
    category: '物流咨询',
    scope: 'global',
    usage_count: 0,
  },
  {
    title: '签收提醒',
    content: '温馨提示：您的订单已显示签收～\n\n请您尽快检查：\n1. 外包装是否完好\n2. 商品数量是否正确\n3. 商品是否有损坏\n\n如有任何问题，请您在24小时内联系我们处理哦！',
    category: '物流咨询',
    scope: 'global',
    usage_count: 0,
  },

  // ==================== 优惠活动 ====================
  {
    title: '优惠券领取',
    content: '您好！优惠券领取方式：\n\n1. 店铺首页横幅领取\n2. 商品详情页领取\n3. 客服专属优惠券（满100可用5元）\n\n您今天是新客首单吗？我可以帮您申请专属优惠哦～',
    category: '优惠活动',
    scope: 'global',
    usage_count: 0,
  },
  {
    title: '满减活动介绍',
    content: '好消息！目前店铺正在做满减活动：\n\n🎉 满200减30\n🎉 满300减50\n🎉 满500减100\n\n活动商品可以叠加使用，多买多优惠哦～请问有什么想要购买的吗？',
    category: '优惠活动',
    scope: 'global',
    usage_count: 0,
  },
  {
    title: '会员优惠说明',
    content: '您好！成为店铺会员可享受以下权益：\n\n1. 会员专享折扣（9-9.5折）\n2. 积分抵现金（100积分=1元）\n3. 生日专属优惠券\n4. 新品优先购买权\n\n您可以点击店铺首页加入会员～',
    category: '优惠活动',
    scope: 'global',
    usage_count: 0,
  },
  {
    title: '活动优惠叠加',
    content: '您好！关于优惠叠加说明：\n\n✅ 店铺满减 + 平台优惠券 可以同时使用\n✅ 会员折扣 + 满减活动 可以同时使用\n❌ 优惠券与秒杀活动不可叠加\n\n建议您将商品加入购物车，系统会自动计算最优优惠方案～',
    category: '优惠活动',
    scope: 'global',
    usage_count: 0,
  },

  // ==================== 投诉建议 ====================
  {
    title: '投诉受理',
    content: '非常抱歉给您带来了不好的体验，您的反馈我们已经收到并高度重视。\n\n请您放心，我们会认真处理您的问题。请提供：\n1. 订单编号\n2. 具体问题描述\n3. 相关图片（如有）\n\n我们会尽快核实并给您一个满意的解决方案！',
    category: '投诉建议',
    scope: 'global',
    usage_count: 0,
  },
  {
    title: '建议感谢',
    content: '非常感谢您提出的宝贵建议！🙏\n\n您的意见对我们非常重要，我们会认真考虑并不断改进。\n\n请问还有其他需要帮助的吗？',
    category: '投诉建议',
    scope: 'global',
    usage_count: 0,
  },
  {
    title: '投诉升级处理',
    content: '您好，我理解您对这个处理结果不太满意。\n\n为了更好地解决您的问题，我会将您的情况升级反馈给主管，24小时内会有专人电话联系您，请保持手机畅通。\n\n给您带来不便再次深表歉意，我们会认真对待每一份反馈！',
    category: '投诉建议',
    scope: 'global',
    usage_count: 0,
  },

  // ==================== 催单/超时相关 ====================
  {
    title: '催单安抚',
    content: '您好，我理解您等待的心情！🙏\n\n我立刻帮您催促一下仓库尽快发货，同时为您申请一张5元无门槛优惠券作为等待补偿，希望能让您稍感安慰～\n\n发货后会第一时间通知您！',
    category: '其他',
    scope: 'global',
    usage_count: 0,
  },
  {
    title: '超时未回复',
    content: '亲爱的顾客您好～\n\n抱歉让您久等了！请问您的问题解决了吗？如果还有其他需要帮助的，随时留言给我哦，我会第一时间为您服务！😊',
    category: '其他',
    scope: 'global',
    usage_count: 0,
  },

  // ==================== 结束语 ====================
  {
    title: '好评邀请',
    content: '感谢您的信任与支持！🌟\n\n如果您对本次购物体验满意，期待您的好评支持～\n如果您有任何建议或意见，也欢迎随时告诉我们，我们会做得更好！\n\n祝您生活愉快！期待下次为您服务～',
    category: '其他',
    scope: 'global',
    usage_count: 0,
  },
  {
    title: '结束语',
    content: '很高兴能帮到您！😊\n\n如果您还有其他问题，随时联系我哦～\n祝您购物愉快，生活顺利！\n\n--您的专属客服',
    category: '其他',
    scope: 'global',
    usage_count: 0,
  },
  {
    title: '节日祝福',
    content: '您好！感谢您一直以来的支持～\n\n在这特别的日子里，祝您{节日名称}快乐！🎉\n\n我们店铺也在举办节日专属活动，欢迎来看看哦～',
    category: '其他',
    scope: 'global',
    usage_count: 0,
  },

  // ==================== AI 专用话术 ====================
  {
    title: '【AI】问候语',
    content: '您好！我是智能客服小帮，很高兴为您服务。请告诉我您想咨询的问题，我会尽快帮您解答～',
    category: '售前咨询',
    scope: 'ai',
    usage_count: 0,
  },
  {
    title: '【AI】无法识别问题',
    content: '抱歉，我暂时无法理解您的问题。您可以尝试：\n1. 换个方式描述您的问题\n2. 提供订单编号方便我查询\n3. 或者输入"转人工"让我帮您连接人工客服',
    category: '其他',
    scope: 'ai',
    usage_count: 0,
  },
  {
    title: '【AI】知识库检索回复',
    content: '根据您的问题，我找到了相关信息：\n\n{知识库内容}\n\n希望对您有帮助！还有其他问题吗？',
    category: '售前咨询',
    scope: 'ai',
    usage_count: 0,
  },

  // ==================== 坐席专用话术 ====================
  {
    title: '【坐席】会话开始',
    content: '您好，我是客服{客服姓名}，工号{工号}，很高兴为您服务！请问有什么可以帮到您？',
    category: '售前咨询',
    scope: 'agent',
    usage_count: 0,
  },
  {
    title: '【坐席】会话结束',
    content: '感谢您的咨询，祝您生活愉快！如有任何问题，欢迎随时联系我们。再见～👋',
    category: '其他',
    scope: 'agent',
    usage_count: 0,
  },
];

async function seedQuickReplies() {
  console.log('🚀 开始初始化话术库...\n');

  let successCount = 0;
  let skipCount = 0;
  const errors: { title: string; error: string }[] = [];

  for (const reply of DEFAULT_QUICK_REPLIES) {
    try {
      // 检查是否已存在
      const { data: existing } = await supabase
        .from('quick_replies')
        .select('id')
        .eq('title', reply.title)
        .eq('scope', reply.scope)
        .limit(1);

      if (existing && existing.length > 0) {
        skipCount++;
        continue;
      }

      const { data, error } = await supabase
        .from('quick_replies')
        .insert({
          title: reply.title,
          content: reply.content,
          category: reply.category,
          scope: reply.scope,
          usage_count: reply.usage_count,
        })
        .select()
        .single();

      if (error) {
        errors.push({ title: reply.title, error: error.message });
      } else {
        successCount++;
      }
    } catch (err) {
      errors.push({ title: reply.title, error: String(err) });
    }
  }

  console.log('\n📊 初始化结果：');
  console.log(`   ✅ 成功添加：${successCount} 条`);
  console.log(`   ⏭️  已跳过（已存在）：${skipCount} 条`);
  console.log(`   ❌ 失败：${errors.length} 条`);

  if (errors.length > 0) {
    console.log('\n⚠️ 失败详情：');
    errors.forEach((e) => console.log(`   - ${e.title}: ${e.error}`));
  }

  // 查询总数确认
  const { count } = await supabase
    .from('quick_replies')
    .select('*', { count: 'exact', head: true });

  console.log(`\n📦 话术库当前总数：${count} 条`);
}

seedQuickReplies()
  .then(() => {
    console.log('\n✨ 初始化完成！');
    process.exit(0);
  })
  .catch((err) => {
    console.error('❌ 初始化失败：', err);
    process.exit(1);
  });
