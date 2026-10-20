import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import App from './App'

vi.mock('./components/PlanCards', () => ({
  PlanCards: () => <div data-testid="plan-cards" />,
}))

vi.mock('./components/PlanGrid', () => ({
  PlanGrid: () => <div data-testid="plan-grid" />,
}))

vi.mock('./components/MissionTimeline', () => ({
  MissionTimeline: () => <div data-testid="mission-timeline" />,
}))

vi.mock('./components/StudioAnalytics', () => ({
  StudioAnalytics: () => <div data-testid="studio-analytics" />,
}))

vi.mock('./components/ActivityFeed', () => ({
  ActivityFeed: () => <div data-testid="activity-feed" />,
}))

vi.mock('./api', () => ({
  createServerApproval: vi.fn().mockRejectedValue(new TypeError('API offline in unit test')),
  createServerPayment: vi.fn(),
  captureServerPayment: vi.fn(),
}))

describe('Mosaic mission room', () => {
  it('keeps payment behind approval and completes the sandbox flow', async () => {
    render(<App />)

    expect(screen.getByText('Ready to review')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Create PayPal order/i })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Approve this plan/i }))
    await waitFor(() => expect(screen.getByRole('button', { name: /Create PayPal order/i })).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /Create PayPal order/i }))
    await waitFor(() => expect(screen.getByRole('button', { name: /Complete Sandbox Checkout/i })).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /Complete Sandbox Checkout/i }))
    expect(screen.getByText('Payment captured')).toBeInTheDocument()
    expect(screen.getByText('Mission funded')).toBeInTheDocument()
  })
})
