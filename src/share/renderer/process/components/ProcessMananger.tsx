import { observer } from 'mobx-react-lite'
import LunaDataGrid from 'luna-data-grid/react'
import DataGrid from 'luna-data-grid'
import { t } from '../../../common/i18n'
import store from '../store'
import Style from './ProcessManager.module.scss'
import { useRef } from 'react'
import { useResizeSensor } from '../../lib/hooks'
import map from 'licia/map'
import fileSize from 'licia/fileSize'

export default observer(function ProcessManager() {
  const dataGridRef = useRef<DataGrid>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useResizeSensor(containerRef, () => dataGridRef.current?.fit())

  const processes = map(store.processes, (process) => {
    return {
      name: process.name,
      pid: process.pid,
      memory: fileSize(process.memory * 1024),
      cpu: process.cpu.toFixed(1),
      type: process.type,
      webContentsId: process.webContentsId,
    }
  })

  return (
    <div className={Style.container} ref={containerRef}>
      <LunaDataGrid
        className={Style.processes}
        onSelect={(node) => store.select(node.data as any)}
        onDeselect={() => store.select(null)}
        filter={store.filter}
        columns={columns}
        selectable={true}
        data={processes}
        uniqueId="pid"
        onCreate={(dataGrid) => {
          dataGridRef.current = dataGrid
          dataGrid.fit()
        }}
      />
    </div>
  )
})

const columns = [
  {
    id: 'name',
    title: t('processName'),
    weight: 40,
    sortable: true,
  },
  {
    id: 'type',
    title: t('type'),
    weight: 15,
    sortable: true,
  },
  {
    id: 'memory',
    title: t('memory'),
    comparator: (a: string, b: string) => fileSize(a) - fileSize(b),
    weight: 15,
    sortable: true,
  },
  {
    id: 'cpu',
    title: '% CPU',
    weight: 15,
    sortable: true,
  },
  {
    id: 'pid',
    title: 'PID',
    weight: 15,
    sortable: true,
  },
]
