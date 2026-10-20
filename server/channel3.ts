import { Channel3 } from '@channel3/sdk'
import type { Channel3Api } from '@channel3/sdk'
import type { MissionCatalog, ProductOption } from '../src/domain/types.js'

const missionQueries: Record<string, string> = {
  water: 'bulk bottled water 500ml cases',
  hygiene: 'hygiene essentials care kits bulk',
  shade: 'pop up shade canopy 10x10',
  snacks: 'nut free snack boxes bulk',
}

const deliveryEstimates: Record<string, { minutes: number; label: string }> = {
  water: { minutes: 340, label: 'Planner estimate · 15:40' },
  hygiene: { minutes: 355, label: 'Planner estimate · 15:55' },
  shade: { minutes: 365, label: 'Planner estimate · 16:05' },
  snacks: { minutes: 340, label: 'Planner estimate · 15:40' },
}

function finiteScore(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback
}

function safeUrl(value: string | undefined): string | undefined {
  if (!value) return undefined
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.toString() : undefined
  } catch {
    return undefined
  }
}

function normalizeProducts(products: readonly Channel3Api.Product[], category: string): ProductOption[] {
  const estimate = deliveryEstimates[category] ?? { minutes: 500, label: 'Planner estimate · confirm at checkout' }
  const result: ProductOption[] = []

  for (const product of products) {
    const title = product.title?.trim()
    if (!product.id || !title) continue
    const brand = product.brands?.find((candidate) => candidate.name?.trim())?.name?.trim() ?? 'Channel3 marketplace'
    const image = product.images?.find((candidate) => candidate.is_main_image)?.cleaned_url
      ?? product.images?.[0]?.cleaned_url
      ?? product.images?.[0]?.url
    const safeImage = safeUrl(image)

    for (const [offerIndex, offer] of (product.offers ?? []).entries()) {
      const price = offer.price?.price
      const offerUrl = safeUrl(offer.url)
      if (offer.availability && offer.availability !== 'InStock') continue
      if (!offerUrl || typeof price !== 'number' || !Number.isFinite(price) || price <= 0) continue
      if (offer.price.currency.toUpperCase() !== 'USD') continue

      const retailer = offer.domain?.replace(/^www\./, '') || new URL(offerUrl).hostname.replace(/^www\./, '')
      result.push({
        id: `channel3:${product.id}:${offerIndex}`,
        title,
        brand,
        price: Math.round(price * 100) / 100,
        unit: category === 'water' ? 'case' : category === 'hygiene' ? 'kit' : category === 'shade' ? 'canopy' : 'box',
        retailer,
        delivery: estimate.label,
        deliveryMinutes: estimate.minutes,
        confidence: finiteScore(0.82 + Math.min(0.15, (product.ratings?.value ?? 0) / 5 * 0.15), 0.82),
        wasteScore: finiteScore(/reus|bulk|refill|organic/i.test(`${title} ${product.description ?? ''}`) ? 0.84 : 0.58, 0.58),
        source: 'channel3',
        ...(safeImage ? { image: safeImage } : {}),
      })
    }
  }

  return result.slice(0, 12)
}

export async function searchMissionCatalog(apiKey: string): Promise<MissionCatalog> {
  const client = new Channel3({ apiKey })
  const catalog: MissionCatalog = {}

  for (const [category, query] of Object.entries(missionQueries)) {
    const page = await client.products.search({
      query,
      limit: 12,
      filters: { availability: ['InStock'] },
      config: { country: 'US', currency: 'USD' },
    })
    const options = normalizeProducts(page.data, category)
    if (options.length < 3) {
      throw new Error(`Channel3 returned fewer than three viable offers for ${category}`)
    }
    catalog[category] = options
  }

  return catalog
}

export function isChannel3Configured(): boolean {
  return Boolean(process.env.CHANNEL3_API_KEY?.trim())
}
