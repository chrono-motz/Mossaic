import { lazy, Suspense, useMemo, useState } from 'react'
import {
  Activity,
  ArrowRight,
  Bot,
  Check,
  ChevronDown,
  CircleDollarSign,
  Clock3,
  Compass,
  GitBranch,
  Layers3,
  LockKeyhole,
  Menu,
  PanelLeft,
  Play,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  Target,
  Wallet,
  Zap,
} from 'lucide-react'
import { ActivityFeed } from './components/ActivityFeed'
import { MetricCard } from './components/MetricCard'
import { PlanCards } from './components/PlanCards'
import { PlanGrid } from './components/PlanGrid'
import { SponsorBadge } from './components/SponsorBadge'
import { captureServerPayment, compileServerMission, createServerApproval, createServerPayment } from './api'
import { approvePlan, createMockPayPalOrder, transitionPayment } from './domain/payment'
import { applyPlanItemChoice, createPlans, formatMoney, formatTime, parseMissionRequest } from './domain/mission'
import type { MissionEvent, MissionStage, PaymentRecord } from './domain/types'

const MissionTimeline = lazy(() => import('./components/MissionTimeline').then((module) => ({ default: module.MissionTimeline })))
const StudioAnalytics = lazy(() => import('./components/StudioAnalytics').then((module) => ({ default: module.StudioAnalytics })))

const starterBrief = 'Create a heat-relief station for 80 people by 6 PM with a $4,500 budget. Prefer low-waste options and keep a reserve.'
const missionId = 'mission-04'

const initialEvents: MissionEvent[] = [
  { id: 'event-1', time: '10:02:14', actor: 'Search', action: 'Product graph', detail: 'Loaded 42 normalized candidate offers across 3 fulfilment paths.', tone: 'accent' },
  { id: 'event-2', time: '10:02:18', actor: 'Bot', action: 'Plan compiler', detail: 'Built 3 Pareto plans across speed, cost and impact.', tone: 'neutral' },
  { id: 'event-3', time: '10:02:21', actor: 'ShieldCheck', action: 'Risk check', detail: 'Fastest plan clears the hard deadline with 86% confidence.', tone: 'success' },
]

function addEvent(events: MissionEvent[], action: string, detail: string, tone: MissionEvent['tone'], actor: MissionEvent['actor'] = 'Bot'): MissionEvent[] {
  return [
    { id: `event-${Date.now()}`, time: new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date()), actor, action, detail, tone },
    ...events,
  ].slice(0, 6)
}

function App() {
  const [brief, setBrief] = useState(starterBrief)
  const [mission, setMission] = useState(() => parseMissionRequest(starterBrief))
  const [plans, setPlans] = useState(() => createPlans(parseMissionRequest(starterBrief)))
  const [selectedPlanId, setSelectedPlanId] = useState('plan-fastest')
  const [stage, setStage] = useState<MissionStage>('ready')
  const [payment, setPayment] = useState<PaymentRecord>({ state: 'not_created', currency: 'USD' })
  const [approvalId, setApprovalId] = useState<string | null>(null)
  const [planHash, setPlanHash] = useState<string | null>(null)
  const [compiledPlanHashes, setCompiledPlanHashes] = useState<Record<string, string> | null>(null)
  const [serverPaymentId, setServerPaymentId] = useState<string | null>(null)
  const [buyerApprovalOpened, setBuyerApprovalOpened] = useState(false)
  const [events, setEvents] = useState(initialEvents)
  const [activeView, setActiveView] = useState<'mission' | 'analytics'>('mission')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [isCompiling, setIsCompiling] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [isActionRunning, setIsActionRunning] = useState(false)

  const selectedPlan = useMemo(() => plans.find((plan) => plan.id === selectedPlanId) ?? plans[0], [plans, selectedPlanId])
  const deadline = formatTime(mission.deadline)
  const isPaid = payment.state === 'paid'

  const compileMission = () => {
    setIsCompiling(true)
    void (async () => {
      try {
        const compiled = await compileServerMission(missionId, brief)
        setMission(compiled.mission)
        setPlans(compiled.plans)
        setSelectedPlanId(compiled.plans[0].id)
        setApprovalId(null)
        setPlanHash(null)
        setCompiledPlanHashes(compiled.planHashes)
        setServerPaymentId(null)
        setBuyerApprovalOpened(false)
        setPayment({ state: 'not_created', currency: 'USD' })
        setStage('ready')
        setNotice(null)
        setEvents((current) => addEvent(current, 'Plan compiler', `${compiled.planner === 'ai' ? 'AI' : 'Deterministic'} planner rebuilt 3 plans from ${compiled.catalogSource === 'channel3' ? 'Channel3' : 'demo'} product paths.`, 'accent'))
      } catch (error) {
        if (!(error instanceof TypeError)) {
          setNotice(error instanceof Error ? error.message : 'Mosaic could not compile this mission.')
          setIsCompiling(false)
          return
        }
        const nextMission = parseMissionRequest(brief)
        const nextPlans = createPlans(nextMission)
        setMission(nextMission)
        setPlans(nextPlans)
        setSelectedPlanId(nextPlans[0].id)
        setApprovalId(null)
        setPlanHash(null)
        setCompiledPlanHashes(null)
        setServerPaymentId(null)
        setBuyerApprovalOpened(false)
        setPayment({ state: 'not_created', currency: 'USD' })
        setStage('ready')
        setNotice('API unavailable. Local plan compiled; start `npm run dev:server` to exercise Channel3 and the AI boundary.')
        setEvents((current) => addEvent(current, 'Plan compiler', 'Local deterministic planner rebuilt 3 plans while the API was offline.', 'warning'))
      }
      setIsCompiling(false)
    })()
  }

  const selectPlan = (planId: string) => {
    if (planId === selectedPlanId) return
    setSelectedPlanId(planId)
    setApprovalId(null)
    setPlanHash(null)
    setCompiledPlanHashes(null)
    setServerPaymentId(null)
    setBuyerApprovalOpened(false)
    setPayment({ state: 'not_created', currency: 'USD' })
    setStage('ready')
    setNotice('Plan changed. Review the new trade-offs before approving payment.')
    setPlans((current) => current.map((plan) => ({ ...plan, status: plan.id === planId ? 'selected' : 'proposed' })))
    setEvents((current) => addEvent(current, 'Plan selected', `${plans.find((plan) => plan.id === planId)?.label ?? 'Plan'} is now the active decision surface.`, 'accent'))
  }

  const changeChoice = (itemId: string, optionId: string) => {
    setPlans((current) => current.map((plan) => plan.id === selectedPlan.id ? applyPlanItemChoice(plan, itemId, optionId, mission.budget) : plan))
    setApprovalId(null)
    setPlanHash(null)
    setCompiledPlanHashes(null)
    setServerPaymentId(null)
    setBuyerApprovalOpened(false)
    setPayment({ state: 'not_created', currency: 'USD' })
    setStage('ready')
    setNotice('Choice changed. Mosaic invalidated the previous approval and recalculated the plan.')
    setEvents((current) => addEvent(current, 'Plan revised', 'AG Grid edit triggered a new cost, confidence and schedule calculation.', 'warning'))
  }

  const approve = async () => {
    const result = approvePlan(selectedPlan, mission.budget)
    if (!result.ok) {
      setNotice(result.reason)
      setEvents((current) => addEvent(current, 'Approval blocked', result.reason, 'warning', 'ShieldCheck'))
      return
    }
    setIsActionRunning(true)
    try {
      const serverApproval = await createServerApproval(missionId, brief, selectedPlan.kind, compiledPlanHashes?.[selectedPlan.kind])
      setApprovalId(serverApproval.approvalId)
      setPlanHash(serverApproval.planHash)
      setNotice(`Plan approved by the Mosaic API using ${serverApproval.planner === 'ai' ? 'the AI planner' : 'the deterministic planner'}. PayPal order creation is unlocked for this exact plan hash.`)
      setEvents((current) => addEvent(current, 'Human approval', `Server recorded ${formatMoney(serverApproval.amountMinor / 100)} from ${serverApproval.catalogSource === 'channel3' ? 'Channel3' : 'demo'} offers against plan hash ${serverApproval.planHash.slice(0, 10)}…`, 'success', 'CheckCircle2'))
    } catch (error) {
      if (!(error instanceof TypeError)) {
        setNotice(error instanceof Error ? error.message : 'Mosaic could not record approval.')
        setIsActionRunning(false)
        return
      }
      setApprovalId(result.approvalId)
      setPlanHash(null)
      setCompiledPlanHashes(null)
      setNotice('API unavailable. Local demo approval recorded; start `npm run dev:server` to exercise the trusted boundary.')
      setEvents((current) => addEvent(current, 'Human approval', `Local fallback approved ${formatMoney(selectedPlan.metrics.total)} with a ${formatMoney(selectedPlan.metrics.reserveRemaining)} reserve.`, 'warning', 'CheckCircle2'))
    }
    setStage('approved')
    setPlans((current) => current.map((plan) => ({ ...plan, status: plan.id === selectedPlan.id ? 'approved' : plan.status })))
    setIsActionRunning(false)
  }

  const fund = async () => {
    if (!approvalId) {
      setNotice('Approve the current plan before creating a PayPal order.')
      return
    }
    setIsActionRunning(true)
    try {
      if (!planHash) throw new TypeError('Local demo approval')
      const serverPayment = await createServerPayment(missionId, approvalId, planHash)
      setServerPaymentId(serverPayment.paymentId)
      const order: PaymentRecord = {
        state: serverPayment.status,
        orderId: serverPayment.paypalOrderId,
        approvalUrl: serverPayment.approvalUrl,
        provider: serverPayment.provider,
        amount: serverPayment.amountMinor / 100,
        currency: serverPayment.currencyCode,
        updatedAt: new Date().toISOString(),
      }
      setPayment(order)
      setBuyerApprovalOpened(false)
      setStage('funding')
      setNotice('Mosaic API created the PayPal order from the approved plan. Complete the buyer step to capture funds.')
      setEvents((current) => addEvent(current, 'PayPal order created', `${order.orderId} · ${formatMoney(order.amount ?? 0)} ${order.currency}`, 'accent', 'CircleDollarSign'))
    } catch (error) {
      if (!(error instanceof TypeError)) {
        setNotice(error instanceof Error ? error.message : 'Mosaic could not create a payment order.')
        setIsActionRunning(false)
        return
      }
      const order = createMockPayPalOrder(selectedPlan, approvalId)
      setPayment(order)
      setStage('funding')
      setNotice('PayPal Sandbox order created in local demo mode. Complete the buyer step to capture funds.')
      setEvents((current) => addEvent(current, 'PayPal order created', `${order.orderId} · ${formatMoney(order.amount ?? 0)} ${order.currency}`, 'warning', 'CircleDollarSign'))
    }
    setIsActionRunning(false)
  }

  const completePayment = async () => {
    setIsActionRunning(true)
    if (serverPaymentId) {
      try {
        const serverPayment = await captureServerPayment(serverPaymentId)
        if (serverPayment.status !== 'paid') throw new Error(serverPayment.failureReason ?? 'Payment was not captured.')
        setPayment((current) => ({ ...current, state: 'paid', updatedAt: new Date().toISOString() }))
      } catch (error) {
        setNotice(error instanceof Error ? error.message : 'Mosaic could not capture the payment.')
        setIsActionRunning(false)
        return
      }
    } else {
      setPayment((current) => transitionPayment(transitionPayment(current, 'payer_approved'), 'paid'))
    }
    setStage('funded')
    setPlans((current) => current.map((plan) => ({ ...plan, status: plan.id === selectedPlan.id ? 'funded' : plan.status })))
    setNotice('Payment captured. Mission is funded and the fulfilment schedule is now live.')
    setEvents((current) => addEvent(current, 'PayPal capture completed', 'Verified payment event moved the mission to FUNDED.', 'success', 'CircleDollarSign'))
    setIsActionRunning(false)
  }

  const openPayPalCheckout = () => {
    if (!payment.approvalUrl) {
      setNotice('PayPal did not return an approval link for this order.')
      return
    }
    window.open(payment.approvalUrl, '_blank', 'noopener,noreferrer')
    setBuyerApprovalOpened(true)
    setNotice('PayPal Checkout opened in a new tab. Return here after buyer approval to capture the order.')
  }

  const stageLabel = stage === 'ready' ? 'Ready to review' : stage === 'approved' ? 'Approval recorded' : stage === 'funding' ? 'Awaiting PayPal' : stage === 'funded' ? 'Mission funded' : 'Draft mission'

  return (
    <div className="app-shell">
      <aside className={`sidebar ${sidebarOpen ? 'sidebar--open' : ''}`}>
        <div className="brand-lockup">
          <div className="brand-mark"><span>m</span></div>
          <div><strong>MOSAIC</strong><small>outcome compiler</small></div>
        </div>
        <div className="workspace-switcher">
          <div className="workspace-avatar">ER</div>
          <div><b>Eastside Relief</b><span>Mission workspace</span></div>
          <ChevronDown size={15} />
        </div>
        <nav className="nav-list" aria-label="Primary navigation">
          <button type="button" className="nav-item nav-item--active" onClick={() => setActiveView('mission')}><Compass size={17} /> Mission room <span className="nav-count">01</span></button>
          <button type="button" className={`nav-item ${activeView === 'analytics' ? 'nav-item--active' : ''}`} onClick={() => setActiveView('analytics')}><Activity size={17} /> Intelligence canvas</button>
          <button type="button" className="nav-item" onClick={() => setNotice('Mission archive is coming after the first live workflow.') }><Layers3 size={17} /> Mission archive</button>
          <button type="button" className="nav-item" onClick={() => setNotice('Agent policy editor is available in the deployed version.') }><LockKeyhole size={17} /> Agent policies</button>
        </nav>
        <div className="sidebar-spacer" />
        <div className="agent-status-card">
          <div className="agent-status-card__top"><span className="live-dot" /> Agents online <span>4 / 4</span></div>
          <div className="agent-status-card__agents"><span><Bot size={13} /> Planner</span><span><Zap size={13} /> Commerce</span><span><GitBranch size={13} /> Scheduler</span><span><ShieldCheck size={13} /> Risk</span></div>
          <div className="agent-budget"><span>Agent budget</span><b>$0.18 / $2.00</b></div>
          <div className="budget-track"><span style={{ width: '9%' }} /></div>
        </div>
        <div className="sidebar-footer"><span className="avatar avatar--lime">AK</span><div><b>Alex Kim</b><span>Coordinator</span></div><Menu size={16} /></div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <button className="mobile-menu" type="button" aria-label="Open navigation" onClick={() => setSidebarOpen((open) => !open)}><PanelLeft size={19} /></button>
          <div className="breadcrumbs"><span>Mission room</span><ArrowRight size={14} /><b>Heat relief station</b></div>
          <div className="topbar-actions"><span className="sandbox-pill"><span className="live-dot" /> Sandbox</span><button className="icon-button" type="button" aria-label="Refresh mission" onClick={compileMission}><RefreshCw size={17} /></button><span className="avatar avatar--orange">AK</span></div>
        </header>

        <div className="content-wrap">
          <section className="hero-block">
            <div>
              <div className="hero-eyebrow"><span className="pulse-mark"><Sparkles size={13} /></span> Mission 04 · agentic commerce in motion</div>
              <h1>Make the outcome<br /><em>happen.</em></h1>
              <p className="hero-copy">Mosaic turns a goal into competing commerce plans, proves what can happen by the deadline, and moves money only after a human says go.</p>
            </div>
            <div className="hero-meta"><div className="hero-meta__number">{isPaid ? '100' : Math.round(selectedPlan.metrics.confidence * 100)}<span>%</span></div><div><span>mission confidence</span><small>{isPaid ? 'funded and in motion' : 'highest confidence path'}</small></div></div>
          </section>

          <section className="command-card">
            <div className="command-card__top"><span className="command-label"><span className="command-dot" /> Tell Mosaic what needs to happen</span><span className="command-hint">AI planner · deterministic demo mode</span></div>
            <textarea aria-label="Mission brief" value={brief} onChange={(event) => setBrief(event.target.value)} rows={2} />
            <div className="command-card__bottom"><div className="constraint-pills"><span><Target size={13} /> {mission.beneficiaries} people</span><span><Clock3 size={13} /> deadline {deadline}</span><span><Wallet size={13} /> {formatMoney(mission.budget)} cap</span></div><button className="compile-button" type="button" onClick={compileMission} disabled={isCompiling}>{isCompiling ? <><RefreshCw size={15} className="spin" /> Replanning</> : <><Play size={15} fill="currentColor" /> Compile mission</>}</button></div>
          </section>

          <div className="sponsor-strip"><span className="sponsor-strip__label">Built with</span><SponsorBadge label="PayPal" tone="blue" /><SponsorBadge label="AG Studio" tone="lime" /><SponsorBadge label="Channel3" tone="orange" /><SponsorBadge label="Bryntum" tone="violet" /><SponsorBadge label="APIMatic" tone="muted" /><SponsorBadge label="Render" tone="muted" /><span className="sponsor-strip__right"><LockKeyhole size={13} /> Human approval required</span></div>

          {notice && <div className={`notice notice--${stage === 'funded' ? 'success' : 'info'}`}><span>{stage === 'funded' ? <Check size={16} /> : <Sparkles size={16} />}</span>{notice}<button type="button" onClick={() => setNotice(null)} aria-label="Dismiss notification">×</button></div>}

          <div className="section-header"><div><span className="section-kicker">01 / plan competition</span><h2>Three ways to make it happen</h2></div><div className="section-header__right"><span className="ai-thinking"><span className="thinking-dots">•••</span> Agents compared 27 options</span><button className="text-button" type="button" onClick={() => setActiveView('analytics')}>Open intelligence canvas <ArrowRight size={14} /></button></div></div>

          <PlanCards plans={plans} selectedPlanId={selectedPlan.id} onSelect={selectPlan} />

          {activeView === 'mission' ? (
            <>
              <div className="section-header section-header--compact"><div><span className="section-kicker">02 / decision surface</span><h2>{selectedPlan.label} plan</h2></div><div className="revision-pill"><span className="live-dot" /> Revision 04 · saved locally</div></div>
              <div className="workspace-grid">
                <div className="workspace-main">
                  <PlanGrid plan={selectedPlan} onChoice={changeChoice} />
                  <div className="timeline-heading"><div><span className="section-kicker">03 / temporal proof</span><h2>Can it happen by {deadline}?</h2></div><div className="timeline-legend"><span><i className="legend-dot legend-dot--green" /> on track</span><span><i className="legend-dot legend-dot--orange" /> watch</span></div></div>
                  <Suspense fallback={<div className="component-loading">Loading temporal proof…</div>}><MissionTimeline plan={selectedPlan} /></Suspense>
                </div>
                <div className="workspace-side">
                  <div className="approval-card">
                    <div className="approval-card__header"><div><span className="section-kicker">Decision gate</span><h3>{stageLabel}</h3></div><div className={`approval-icon approval-icon--${isPaid ? 'success' : stage === 'approved' ? 'approved' : 'idle'}`}>{isPaid ? <Check size={21} /> : stage === 'approved' ? <ShieldCheck size={21} /> : <LockKeyhole size={20} />}</div></div>
                    <p>{isPaid ? 'PayPal captured funds. Supplier confirmations and the field schedule are now in motion.' : stage === 'approved' ? 'The plan hash is locked. Mosaic can now create the PayPal order for this exact revision.' : 'Mosaic will never spend against a plan that has not been reviewed and approved.'}</p>
                    <div className="approval-summary"><div><span>Plan total</span><b>{formatMoney(selectedPlan.metrics.total)}</b></div><div><span>Reserve</span><b className={selectedPlan.metrics.reserveRemaining < 400 ? 'text-orange' : ''}>{formatMoney(selectedPlan.metrics.reserveRemaining)}</b></div><div><span>Provider</span><b className="paypal-wordmark">PayPal</b></div></div>
                    {!approvalId && !isPaid && <button className="primary-action" type="button" onClick={() => void approve()} disabled={isActionRunning}><ShieldCheck size={16} /> {isActionRunning ? 'Recording approval…' : 'Approve this plan'} <ArrowRight size={16} /></button>}
                    {approvalId && !isPaid && payment.state === 'not_created' && <button className="primary-action primary-action--paypal" type="button" onClick={() => void fund()} disabled={isActionRunning}><CircleDollarSign size={17} /> {isActionRunning ? 'Creating order…' : 'Create PayPal order'} <ArrowRight size={16} /></button>}
                    {payment.state === 'created' && !isPaid && payment.provider === 'paypal' && !buyerApprovalOpened && <button className="primary-action primary-action--paypal" type="button" onClick={openPayPalCheckout}><CircleDollarSign size={17} /> Open PayPal Checkout <ArrowRight size={16} /></button>}
                    {payment.state === 'created' && !isPaid && (payment.provider === 'demo' || buyerApprovalOpened) && <button className="primary-action primary-action--paypal" type="button" onClick={() => void completePayment()} disabled={isActionRunning}><CircleDollarSign size={17} /> {isActionRunning ? 'Capturing…' : payment.provider === 'demo' ? 'Complete Sandbox Checkout' : 'Capture approved payment'} <ArrowRight size={16} /></button>}
                    {isPaid && <div className="paid-receipt"><Check size={16} /><div><b>Payment captured</b><span>{payment.orderId} · {formatMoney(payment.amount ?? 0)}</span></div></div>}
                    <div className="approval-protocol"><LockKeyhole size={13} /> approval bound to plan hash · {approvalId ? 'verified' : 'waiting'}</div>
                  </div>
                  <ActivityFeed events={events} />
                </div>
              </div>
            </>
          ) : (
            <Suspense fallback={<div className="component-loading component-loading--studio">Loading intelligence canvas…</div>}><StudioAnalytics plan={selectedPlan} events={events} /></Suspense>
          )}

          <section className="metric-row">
            <MetricCard eyebrow="PayPal funding" value={isPaid ? 'Captured' : payment.state === 'created' ? 'Order ready' : 'Approval gated'} detail={isPaid ? 'Verified Sandbox event' : 'No autonomous spend'} icon={<CircleDollarSign size={18} />} tone="blue" />
            <MetricCard eyebrow="Schedule headroom" value={`${Math.max(0, Math.round((480 - selectedPlan.metrics.arrivalMinutes) / 60 * 10) / 10)} hrs`} detail={`Arrival at ${selectedPlan.metrics.arrival}`} icon={<Clock3 size={18} />} tone="lime" />
            <MetricCard eyebrow="Product graph" value={`${selectedPlan.metrics.supplierCount} paths`} detail="Channel3 candidates normalised" icon={<Layers3 size={18} />} tone="orange" />
            <MetricCard eyebrow="Agent trace" value="100%" detail="Every tool call recorded" icon={<Activity size={18} />} tone="violet" />
          </section>

          <footer className="app-footer"><span><span className="footer-mark">m</span> Mosaic is a PayPal Sandbox prototype.</span><span>APIMatic context · Render runtime · Agent policy: human-in-the-loop</span><button type="button" onClick={() => setNotice('The audit export will be available in the next build.')}>Export audit trace <Send size={13} /></button></footer>
        </div>
      </main>
    </div>
  )
}

export default App
