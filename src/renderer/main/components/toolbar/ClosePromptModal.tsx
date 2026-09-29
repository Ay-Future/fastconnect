import LunaModal from 'luna-modal/react'
import { createPortal } from 'react-dom'
import { useEffect, useState } from 'react'
import Style from './ClosePromptModal.module.scss'

type CloseAction = 'minimize' | 'quit' | 'cancel'

export default function ClosePromptModal() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    return main.on('requestCloseMainWindow', () => setVisible(true))
  }, [])

  function resolve(action: CloseAction) {
    setVisible(false)
    void main.resolveMainClose(action)
  }

  return createPortal(
    <LunaModal
      title={`关闭 ${PRODUCT_NAME}`}
      visible={visible}
      width={440}
      onClose={() => resolve('cancel')}
    >
      <div className={Style.content}>
        <div className={Style.title}>是否最小化并继续运行？</div>
        <div className={Style.description}>
          最小化会保持 {PRODUCT_NAME} 与正在运行的 Fastbug Collector 继续工作；退出会停止 {PRODUCT_NAME} 托管的 Collector。
        </div>
        <div className={Style.actions}>
          <button className={Style.button} onClick={() => resolve('cancel')}>
            取消
          </button>
          <button
            className={`${Style.button} ${Style.danger}`}
            onClick={() => resolve('quit')}
          >
            退出 {PRODUCT_NAME}
          </button>
          <button
            className={`${Style.button} ${Style.primary}`}
            onClick={() => resolve('minimize')}
          >
            最小化并继续运行
          </button>
        </div>
      </div>
    </LunaModal>,
    document.body
  )
}
