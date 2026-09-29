import { observer } from 'mobx-react-lite'
import { useEffect, useState, type ReactNode } from 'react'
import LunaToolbar, {
  LunaToolbarSpace,
  LunaToolbarText,
} from 'luna-toolbar/react'
import className from 'licia/className'
import ToolbarIcon from 'share/renderer/components/ToolbarIcon'
import { notify } from 'share/renderer/lib/util'
import { t } from 'common/util'
import Style from './QuestionDebug.module.scss'
import store from '../../store'
import { PannelLoading } from '../common/loading'

const PLACEHOLDER =
  'chinesec83dc48a40424db2845529a3c3b9bd2f\nmath1234567890abcdef1234567890abcdef'

interface IQuestionRow {
  key: string
  value: string
}

export default observer(function QuestionDebug() {
  const [rawInput, setRawInput] = useState('')
  const [currentQuestionId, setCurrentQuestionId] = useState('')
  const [activeRowKey, setActiveRowKey] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submittingRowKey, setSubmittingRowKey] = useState('')
  const { device, panel } = store

  const rows = getQuestionRows(rawInput)

  useEffect(() => {
    setCurrentQuestionId('')
    setActiveRowKey('')
    setIsLoading(false)
    setIsSubmitting(false)
    setSubmittingRowKey('')
  }, [device?.id])

  useEffect(() => {
    if (activeRowKey && !rows.some((row) => row.key === activeRowKey)) {
      setActiveRowKey(getMatchedRowKey(rows, currentQuestionId))
    }
  }, [activeRowKey, currentQuestionId, rows])

  useEffect(() => {
    if (panel === 'questionDebug') {
      refresh()
    }
  }, [device?.id, panel])

  async function refresh() {
    if (!device || isLoading) {
      return
    }

    try {
      setIsLoading(true)
      const questionId = await main.getMockQuestionId(device.id)
      setCurrentQuestionId(questionId)
      setActiveRowKey(getMatchedRowKey(rows, questionId))
    } catch {
      notify('读取题目ID失败', { icon: 'error' })
    } finally {
      setIsLoading(false)
    }
  }

  async function writeQuestion(row: IQuestionRow) {
    if (!device || !row.value || isSubmitting) {
      return
    }

    try {
      setIsSubmitting(true)
      setSubmittingRowKey(row.key)
      const appliedQuestionId = await main.setMockQuestionId(device.id, row.value)
      setCurrentQuestionId(appliedQuestionId)
      setActiveRowKey(row.key)
      notify('写入题目成功', { icon: 'success' })
    } catch {
      notify('写入题目失败', { icon: 'error' })
    } finally {
      setIsSubmitting(false)
      setSubmittingRowKey('')
    }
  }

  async function resetQuestion() {
    if (!device || isSubmitting) {
      return
    }

    try {
      setIsSubmitting(true)
      await main.resetMockQuestionId(device.id)
      setCurrentQuestionId('')
      setActiveRowKey('')
      notify('题目ID已重置', { icon: 'success' })
    } catch {
      notify('重置题目ID失败', { icon: 'error' })
    } finally {
      setIsSubmitting(false)
      setSubmittingRowKey('')
    }
  }

  function renderRows(): ReactNode {
    if (!rows.length) {
      return (
        <div className={Style.emptyList}>
          输入多行题目 ID 后，这里会按行生成操作项
        </div>
      )
    }

    return rows.map((row, idx) => {
      const active = isActiveRow(row, activeRowKey, currentQuestionId)
      const busy = isSubmitting && submittingRowKey === row.key

      return (
        <div
          key={row.key}
          className={className(Style.rowCard, {
            [Style.rowCardActive]: active,
          })}
        >
          <div className={Style.rowHeader}>
            <span className={Style.rowIndex}>#{idx + 1}</span>
            {active ? <span className={Style.activeTag}>当前生效</span> : null}
          </div>
          <div className={Style.rowContent}>
            <div className={Style.questionId}>{row.value}</div>
            <div className={Style.rowActions}>
              <button
                className={Style.primaryButton}
                disabled={!device || isSubmitting || active}
                onClick={() => writeQuestion(row)}
              >
                {busy ? '写入中...' : active ? '已生效' : '写入题目'}
              </button>
              <button
                className={Style.secondaryButton}
                disabled={!device || isSubmitting}
                onClick={resetQuestion}
              >
                重置
              </button>
            </div>
          </div>
        </div>
      )
    })
  }

  let content: ReactNode = null

  if (!device) {
    content = (
      <div className={className('panel-body', Style.empty)}>
        {t('deviceNotConnected')}
      </div>
    )
  } else if (isLoading && !currentQuestionId && !rawInput) {
    content = <PannelLoading />
  } else {
    content = (
      <div className={className('panel-body', Style.container)}>
        <div className={Style.content}>
          <div className={Style.topGrid}>
            <section className={Style.card}>
              <div className={Style.cardHeader}>
                <div>
                  <h3 className={Style.cardTitle}>题目ID输入</h3>
                  <p className={Style.cardHint}>
                    一行一个题目 ID，支持直接粘贴多行。写入新的题目后，旧题目会被覆盖。
                  </p>
                </div>
              </div>
              <textarea
                className={Style.input}
                value={rawInput}
                placeholder={PLACEHOLDER}
                onChange={(e) => setRawInput(e.target.value)}
                spellCheck={false}
              />
            </section>

            <section className={Style.card}>
              <div className={Style.cardHeader}>
                <div>
                  <h3 className={Style.cardTitle}>当前生效题目</h3>
                  <p className={Style.cardHint}>
                    写入命令：
                    <code className={Style.code}>
                      settings put global mock_question_id &lt;题目ID&gt;
                    </code>
                  </p>
                </div>
                <button
                  className={Style.secondaryButton}
                  disabled={!device || isSubmitting}
                  onClick={resetQuestion}
                >
                  重置
                </button>
              </div>
              <div
                className={className(Style.currentValue, {
                  [Style.currentValueEmpty]: !currentQuestionId,
                })}
              >
                {currentQuestionId || '当前未写入题目ID'}
              </div>
            </section>
          </div>

          <section className={Style.card}>
            <div className={Style.cardHeader}>
              <div>
                <h3 className={Style.cardTitle}>按行操作</h3>
                <p className={Style.cardHint}>
                  每一行都可以单独写入或重置，但任意时刻只会有一个题目 ID 生效。
                </p>
              </div>
            </div>
            <div className={Style.list}>{renderRows()}</div>
          </section>
        </div>
      </div>
    )
  }

  return (
    <div className="panel-with-toolbar">
      <LunaToolbar className="panel-toolbar">
        <LunaToolbarText
          text={`当前状态 ${currentQuestionId ? '已写入题目' : '未写入题目'}`}
        />
        <LunaToolbarSpace />
        <ToolbarIcon
          icon="refresh"
          title={t('refresh')}
          disabled={!device || isLoading || isSubmitting}
          onClick={refresh}
        />
      </LunaToolbar>
      {content}
    </div>
  )
})

function getQuestionRows(rawInput: string): IQuestionRow[] {
  return rawInput
    .split(/\r?\n/)
    .map((row) => row.trim())
    .filter(Boolean)
    .map((value, idx) => ({
      key: `${idx}-${value}`,
      value,
    }))
}

function getMatchedRowKey(rows: IQuestionRow[], questionId: string) {
  const matchedRow = rows.find((row) => row.value === questionId)

  return matchedRow ? matchedRow.key : ''
}

function isActiveRow(
  row: IQuestionRow,
  activeRowKey: string,
  currentQuestionId: string
) {
  if (activeRowKey) {
    return row.key === activeRowKey
  }

  return Boolean(currentQuestionId) && row.value === currentQuestionId
}
