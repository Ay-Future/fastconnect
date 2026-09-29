import Style from './App.module.scss'
import icon from '../../../renderer/assets/icon.png'
import { t } from '../../common/i18n'

export default function App() {
  return (
    <div className={Style.container}>
      <img src={icon} />
      <div>{PRODUCT_NAME}</div>
      <div>
        {t('version')} {VERSION}
      </div>
    </div>
  )
}
