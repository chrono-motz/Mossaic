import { useMemo } from 'react'
import { AgGridReact } from 'ag-grid-react'
import type { CellValueChangedEvent, ColDef } from 'ag-grid-community'
import type { MissionPlan } from '../domain/types'
import { formatMoney } from '../domain/mission'

interface PlanGridProps {
  plan: MissionPlan
  onChoice: (itemId: string, optionId: string) => void
}

interface GridRow {
  itemId: string
  category: string
  requirement: string
  quantity: number
  product: string
  retailer: string
  selectedId: string
  choices: string[]
  unitPrice: number
  total: number
  arrival: string
  confidence: number
  priority: string
}

export function PlanGrid({ plan, onChoice }: PlanGridProps) {
  const rows = useMemo<GridRow[]>(() => plan.items.map((item) => ({
    itemId: item.id,
    category: item.category,
    requirement: item.requirement,
    quantity: item.quantity,
    product: item.selected.title,
    retailer: item.selected.retailer,
    selectedId: item.selected.id,
    choices: item.alternatives.map((option) => option.id),
    unitPrice: item.selected.price,
    total: item.quantity * item.selected.price,
    arrival: item.selected.delivery,
    confidence: item.selected.confidence,
    priority: item.priority,
  })), [plan])

  const columns = useMemo<ColDef<GridRow>[]>(() => [
    {
      field: 'category',
      headerName: 'Need',
      width: 108,
      cellRenderer: ({ value }: { value: string }) => <span className="grid-category">{value}</span>,
    },
    { field: 'requirement', headerName: 'Requirement', minWidth: 155, flex: 1 },
    { field: 'quantity', headerName: 'Qty', width: 70, type: 'numericColumn' },
    { field: 'product', headerName: 'Selected product', minWidth: 218, flex: 1.2 },
    { field: 'retailer', headerName: 'Retailer', minWidth: 140 },
    {
      field: 'selectedId',
      headerName: 'Change choice',
      editable: true,
      width: 152,
      cellEditor: 'agSelectCellEditor',
      cellEditorParams: ({ data }: { data: GridRow }) => ({ values: data.choices }),
      valueFormatter: ({ value, data }) => data?.choices.indexOf(value) === 0 ? 'Fast route' : data?.choices.indexOf(value) === 1 ? 'Budget route' : 'Low-waste route',
      cellClass: 'grid-editable-cell',
    },
    {
      field: 'total',
      headerName: 'Line total',
      width: 105,
      valueFormatter: ({ value }) => formatMoney(value),
    },
    {
      field: 'arrival',
      headerName: 'Arrival',
      minWidth: 122,
      cellRenderer: ({ value }: { value: string }) => <span className="grid-arrival">{value}</span>,
    },
    {
      field: 'confidence',
      headerName: 'Confidence',
      width: 116,
      valueFormatter: ({ value }) => `${Math.round(value * 100)}%`,
      cellClass: ({ value }) => value >= 0.9 ? 'confidence-high' : 'confidence-watch',
    },
  ], [])

  const handleChange = (event: CellValueChangedEvent<GridRow>) => {
    if (event.colDef.field === 'selectedId' && typeof event.newValue === 'string' && event.newValue !== event.oldValue) {
      onChoice(event.data.itemId, event.newValue)
    }
  }

  return (
    <div className="grid-shell">
      <div className="grid-toolbar">
        <div><span className="live-dot" /> Live plan compiler</div>
        <span>Edit a choice to re-run the plan math</span>
      </div>
      <div className="ag-theme-quartz mosaic-grid">
        <AgGridReact
          rowData={rows}
          columnDefs={columns}
          getRowId={({ data }) => data.itemId}
          onCellValueChanged={handleChange}
          domLayout="autoHeight"
          headerHeight={42}
          rowHeight={58}
          suppressCellFocus={false}
          animateRows
        />
      </div>
    </div>
  )
}
