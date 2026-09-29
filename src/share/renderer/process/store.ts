import BaseStore from '../store/BaseStore'
import { IProcess } from '../../common/types'
import { action, makeObservable, observable, runInAction } from 'mobx'

class Store extends BaseStore {
  processes: IProcess[] = []
  process: IProcess | null = null
  filter = ''
  constructor() {
    super()

    makeObservable(this, {
      processes: observable,
      process: observable,
      filter: observable,
      setFilter: action,
      select: action,
    })

    this.init()
  }
  select(process: IProcess | null) {
    this.process = process
  }
  setFilter(filter: string) {
    this.filter = filter
  }
  async init() {
    this.refresh()
    setInterval(() => this.refresh(), 2000)
  }
  async refresh() {
    const processes = await main.getProcessData()
    runInAction(() => {
      this.processes = processes
    })
  }
}

export default new Store()
