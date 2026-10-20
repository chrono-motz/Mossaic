export const DEMO_NOW = '2026-10-20T10:00:00';
export const DEMO_DEADLINE = '2026-10-20T18:00:00';
export const catalog = {
    water: [
        {
            id: 'water-express',
            title: 'Spring water · 24 × 500ml',
            brand: 'Flowstate',
            price: 8.4,
            unit: 'case',
            retailer: 'Northstar Market',
            delivery: 'Today · 15:40',
            deliveryMinutes: 340,
            confidence: 0.94,
            wasteScore: 0.38,
            source: 'demo-catalog',
        },
        {
            id: 'water-budget',
            title: 'Spring water · 24 × 500ml',
            brand: 'Clearwell',
            price: 5.8,
            unit: 'case',
            retailer: 'ValueCart',
            delivery: 'Today · 19:20',
            deliveryMinutes: 560,
            confidence: 0.72,
            wasteScore: 0.46,
            source: 'demo-catalog',
        },
        {
            id: 'water-refill',
            title: 'Refill station barrels · 20L',
            brand: 'OpenSpring',
            price: 12.2,
            unit: 'barrel',
            retailer: 'GreenRoute Co-op',
            delivery: 'Today · 17:10',
            deliveryMinutes: 430,
            confidence: 0.91,
            wasteScore: 0.87,
            source: 'demo-catalog',
        },
    ],
    hygiene: [
        {
            id: 'hygiene-fast',
            title: 'Ready hygiene kit · 8 essentials',
            brand: 'CareKit',
            price: 8.4,
            unit: 'kit',
            retailer: 'Northstar Market',
            delivery: 'Today · 15:40',
            deliveryMinutes: 340,
            confidence: 0.94,
            wasteScore: 0.62,
            source: 'demo-catalog',
        },
        {
            id: 'hygiene-budget',
            title: 'Hygiene essentials bundle · 8 items',
            brand: 'Everyday Good',
            price: 6.5,
            unit: 'bundle',
            retailer: 'ValueCart',
            delivery: 'Today · 18:40',
            deliveryMinutes: 520,
            confidence: 0.77,
            wasteScore: 0.52,
            source: 'demo-catalog',
        },
        {
            id: 'hygiene-reusable',
            title: 'Reusable care pouch · 10 essentials',
            brand: 'KindCarry',
            price: 11.6,
            unit: 'pouch',
            retailer: 'GreenRoute Co-op',
            delivery: 'Today · 17:10',
            deliveryMinutes: 430,
            confidence: 0.91,
            wasteScore: 0.93,
            source: 'demo-catalog',
        },
    ],
    shade: [
        {
            id: 'shade-fast',
            title: 'Pop-up shade canopy · 10 × 10 ft',
            brand: 'Sunbreak',
            price: 84,
            unit: 'canopy',
            retailer: 'Northstar Market',
            delivery: 'Today · 16:05',
            deliveryMinutes: 365,
            confidence: 0.9,
            wasteScore: 0.55,
            source: 'demo-catalog',
        },
        {
            id: 'shade-budget',
            title: 'Pop-up shade canopy · 10 × 10 ft',
            brand: 'Everyday Good',
            price: 59,
            unit: 'canopy',
            retailer: 'ValueCart',
            delivery: 'Today · 18:50',
            deliveryMinutes: 530,
            confidence: 0.7,
            wasteScore: 0.47,
            source: 'demo-catalog',
        },
        {
            id: 'shade-reusable',
            title: 'Commercial shade canopy · 10 × 10 ft',
            brand: 'LongArc',
            price: 108,
            unit: 'canopy',
            retailer: 'GreenRoute Co-op',
            delivery: 'Today · 16:40',
            deliveryMinutes: 400,
            confidence: 0.95,
            wasteScore: 0.96,
            source: 'demo-catalog',
        },
    ],
    snacks: [
        {
            id: 'snacks-fast',
            title: 'Nut-free snack box · 24 servings',
            brand: 'BrightBite',
            price: 29,
            unit: 'box',
            retailer: 'Northstar Market',
            delivery: 'Today · 15:40',
            deliveryMinutes: 340,
            confidence: 0.94,
            wasteScore: 0.5,
            source: 'demo-catalog',
        },
        {
            id: 'snacks-budget',
            title: 'Granola snack box · 24 servings',
            brand: 'ValueCart House',
            price: 21,
            unit: 'box',
            retailer: 'ValueCart',
            delivery: 'Today · 18:40',
            deliveryMinutes: 520,
            confidence: 0.77,
            wasteScore: 0.43,
            source: 'demo-catalog',
        },
        {
            id: 'snacks-reusable',
            title: 'Bulk snack crate · 30 servings',
            brand: 'Local Table',
            price: 36,
            unit: 'crate',
            retailer: 'GreenRoute Co-op',
            delivery: 'Today · 17:10',
            deliveryMinutes: 430,
            confidence: 0.91,
            wasteScore: 0.89,
            source: 'demo-catalog',
        },
    ],
};
function money(value) {
    return Math.round(value * 100) / 100;
}
function readBudget(text) {
    const match = text.match(/\$\s?([\d,]+)/i);
    return match ? Number(match[1].replaceAll(',', '')) : 4500;
}
function readBeneficiaries(text) {
    const match = text.match(/(\d+)\s*(?:people|guests|attendees|families)/i);
    return match ? Number(match[1]) : 80;
}
function readDeadline(text) {
    const match = text.match(/by\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
    if (!match)
        return DEMO_DEADLINE;
    let hour = Number(match[1]);
    const minute = Number(match[2] ?? 0);
    const meridiem = match[3]?.toLowerCase();
    if (meridiem === 'pm' && hour < 12)
        hour += 12;
    if (meridiem === 'am' && hour === 12)
        hour = 0;
    return `2026-10-20T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`;
}
export function parseMissionRequest(text) {
    const trimmed = text.trim();
    const budget = readBudget(trimmed);
    const beneficiaries = readBeneficiaries(trimmed);
    const deadline = readDeadline(trimmed);
    const constraints = ['Keep an emergency reserve', 'Require a human approval before payment'];
    if (/waste|reus|sustainab/i.test(trimmed))
        constraints.push('Prefer low-waste alternatives');
    if (/fast|urgent|asap|tonight/i.test(trimmed))
        constraints.push('Prioritise arrival confidence');
    return {
        title: /heat|cool/i.test(trimmed) ? 'Heat relief station' : 'Community mission',
        brief: trimmed || 'Create a heat-relief station for 80 people by 6 PM with a $4,500 budget.',
        budget,
        reserve: Math.max(200, Math.round(budget * 0.07)),
        deadline,
        beneficiaries,
        constraints,
        parserConfidence: trimmed ? 0.94 : 0.82,
    };
}
function task(id, name, lane, start, durationMinutes, dependencyIds, status = 'queued') {
    const end = new Date(new Date(start).getTime() + durationMinutes * 60_000).toISOString().slice(0, 19);
    return { id, name, lane, start, end, durationMinutes, dependencyIds, status };
}
function buildItems(kind, sourceCatalog = catalog) {
    const index = kind === 'fastest' ? 0 : kind === 'balanced' ? 1 : 2;
    const multiplier = kind === 'fastest' ? 1 : kind === 'balanced' ? 0.95 : 1.02;
    const pick = (key, requirement, quantity, priority) => {
        const options = sourceCatalog[key] ?? catalog[key];
        const selected = options[index] ?? options[0] ?? catalog[key][index];
        return {
            id: `${kind}-${key}`,
            category: key,
            requirement,
            quantity,
            selected: { ...selected, price: money(selected.price * multiplier) },
            alternatives: options,
            priority,
        };
    };
    return [
        pick('water', 'Water access', kind === 'low-waste' ? 8 : 7, 'essential'),
        pick('hygiene', 'Hygiene kits', 80, 'essential'),
        pick('shade', 'Shade coverage', 2, 'essential'),
        pick('snacks', 'Nut-free snacks', kind === 'low-waste' ? 6 : 7, 'recommended'),
    ];
}
function buildTasks(kind) {
    const delivery = kind === 'fastest' ? '2026-10-20T15:40:00' : kind === 'balanced' ? '2026-10-20T17:00:00' : '2026-10-20T17:10:00';
    const preparationStart = kind === 'fastest' ? '2026-10-20T14:15:00' : '2026-10-20T15:20:00';
    return [
        task(`${kind}-fund`, 'Fund mission', 'Mosaic finance', '2026-10-20T10:15:00', 10, [], 'ready'),
        task(`${kind}-confirm`, 'Confirm suppliers', 'Commerce agent', preparationStart, 35, [`${kind}-fund`]),
        task(`${kind}-pack`, 'Pack and stage goods', 'Supplier hub', '2026-10-20T15:00:00', 55, [`${kind}-confirm`]),
        task(`${kind}-pickup`, 'Volunteer pickup', 'Field team', '2026-10-20T16:05:00', 35, [`${kind}-pack`]),
        task(`${kind}-deliver`, 'Deliver to station', 'Field team', delivery, 25, [`${kind}-pickup`], kind === 'balanced' ? 'at-risk' : 'queued'),
    ];
}
function computeMetrics(items, kind, budget) {
    const total = money(items.reduce((sum, item) => sum + item.quantity * item.selected.price, 0) + (kind === 'fastest' ? 1380 : kind === 'balanced' ? 1020 : 1170));
    const arrivalMinutes = kind === 'fastest' ? 340 : kind === 'balanced' ? 420 : 430;
    return {
        total,
        arrival: kind === 'fastest' ? '15:40' : kind === 'balanced' ? '17:00' : '17:10',
        arrivalMinutes,
        confidence: kind === 'fastest' ? 0.86 : kind === 'balanced' ? 0.79 : 0.92,
        wasteScore: kind === 'fastest' ? 0.51 : kind === 'balanced' ? 0.62 : 0.9,
        supplierCount: kind === 'balanced' ? 2 : 3,
        reserveRemaining: money(budget - total),
    };
}
export function createPlans(mission, catalogOverrides = {}) {
    const sourceCatalog = { ...catalog };
    for (const [category, options] of Object.entries(catalogOverrides)) {
        if (options)
            sourceCatalog[category] = options;
    }
    const definitions = [
        ['fastest', 'Fastest viable', 'Deadline first', 'Arrives before the rush, using high-confidence express suppliers.', '#e9f66a'],
        ['balanced', 'Best value', 'Cost / time balance', 'Protects the budget while still targeting the 6 PM mission window.', '#8fe4c4'],
        ['low-waste', 'Lowest waste', 'Impact first', 'Chooses reusable and bulk options, with the strongest impact score.', '#ffb07c'],
    ];
    return definitions.map(([kind, label, kicker, description, color]) => {
        const items = buildItems(kind, sourceCatalog);
        return {
            id: `plan-${kind}`,
            kind,
            label,
            kicker,
            description,
            color,
            items,
            tasks: buildTasks(kind),
            metrics: computeMetrics(items, kind, mission.budget),
            decisionNotes: kind === 'fastest'
                ? ['All essential categories have a 90%+ fulfilment path.', 'Higher spend buys 90 minutes of schedule headroom.']
                : kind === 'balanced'
                    ? ['The cheapest option misses the hard deadline by 80 minutes.', 'Two suppliers reduce coordination overhead.']
                    : ['Reusable options reduce packaging waste by an estimated 39%.', 'The plan keeps a smaller but viable contingency reserve.'],
            status: 'proposed',
        };
    });
}
export function applyPlanItemChoice(plan, itemId, optionId, budget) {
    const items = plan.items.map((item) => {
        if (item.id !== itemId)
            return item;
        const replacement = item.alternatives.find((option) => option.id === optionId);
        if (!replacement)
            return item;
        return { ...item, selected: replacement };
    });
    return {
        ...plan,
        items,
        metrics: computeMetrics(items, plan.kind, budget),
        status: 'proposed',
    };
}
export function validatePlan(plan, budget) {
    const conflicts = [];
    if (plan.metrics.total > budget)
        conflicts.push(`Plan exceeds the approved budget by $${(plan.metrics.total - budget).toFixed(2)}.`);
    if (plan.metrics.reserveRemaining < 0)
        conflicts.push('The emergency reserve has been consumed.');
    const taskIds = new Set(plan.tasks.map((item) => item.id));
    plan.tasks.forEach((item) => item.dependencyIds.forEach((dependencyId) => {
        if (!taskIds.has(dependencyId))
            conflicts.push(`${item.name} references a missing dependency.`);
    }));
    return conflicts;
}
export function formatMoney(value) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);
}
export function formatTime(value) {
    return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(new Date(value));
}
//# sourceMappingURL=mission.js.map