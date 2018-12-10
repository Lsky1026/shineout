import isObject from '../utils/validate/isObject'
import { flatten, unflatten, insertValue, spliceValue, getSthByName, removeSthByName } from '../utils/flat'
import { deepGet, deepSet, deepRemove, fastClone } from '../utils/objects'
import { promiseAll, FormError } from '../utils/errors'
import {
  updateSubscribe, errorSubscribe, changeSubscribe,
  VALIDATE_TOPIC, RESET_TOPIC, CHANGE_TOPIC, FORCE_PASS, ERROR_TYPE,
} from './types'

export default class {
  constructor(options = {}) {
    const {
      removeUndefined = true, rules, onChange, value, error,
    } = options
    this.$inputNames = {}
    this.rules = rules
    this.onChange = onChange
    this.removeUndefined = removeUndefined

    // store raw form values
    this.$values = {}
    // store default value, for reset
    this.$defaultValues = {}
    this.$validator = {}
    this.$events = {}
    // handle global errors
    this.$errors = {}

    this.deepSetOptions = { removeUndefined }

    if (value) this.setValue(value)
    if (error) this.setError('', error)
  }

  handleChange() {
    if (this.onChange) this.onChange(this.getValue())
  }

  reset() {
    this.dispatch(RESET_TOPIC)
    this.$errors = {}
    this.setValue(unflatten(fastClone(this.$defaultValues)), FORCE_PASS)
  }

  get(name) {
    return deepGet(this.$values, name)
  }

  set(name, value, pub = true) {
    if (typeof name === 'object') {
      value = name
      name = ''
    }

    if (value === this.get(name)) return
    deepSet(this.$values, name, value, this.deepSetOptions)

    if (pub) {
      if (this.$inputNames[name]) {
        this.dispatch(updateSubscribe(name), value, name)
        this.dispatch(changeSubscribe(name))
      } else {
        this.publishValue(name, value)
      }
    }

    this.dispatch(CHANGE_TOPIC)
    this.handleChange()
  }

  remove(name) {
    deepRemove(this.$values, name)
  }

  publishValue(path, value) {
    const names = []
    if (isObject(value)) {
      Object.keys(value).forEach((name) => {
        names.push([`${path}${path ? '.' : ''}${name}`, value[name]])
      })
    } else if (Array.isArray(value)) {
      value.forEach((v, i) => {
        names.push([`${path}[${i}]`, v])
      })
    }

    names.forEach(([name, val]) => {
      if (this.$inputNames[name]) {
        this.dispatch(updateSubscribe(name), val, name)
        this.dispatch(changeSubscribe(name))
      }
      this.publishValue(name, val)
    })
  }

  getError(name) {
    return getSthByName(name, this.$errors)
  }

  setError(name, error, pub) {
    this.$errors[name] = error
    // if (pub) this.throughError('', unflatten({ [name]: error }))
    if (pub) {
      name.split('.').reduce((n, s) => {
        const nn = `${n}${n ? '.' : ''}${s}`
        this.dispatch(errorSubscribe(nn), this.getError(nn), nn, ERROR_TYPE)
        return nn
      }, '')
    }
  }

  removeError(name, pub) {
    removeSthByName(name, this.$errors)
    if (pub) {
      name.split('.').reduce((n, s) => {
        const nn = `${n}${n ? '.' : ''}${s}`
        this.dispatch(errorSubscribe(nn), this.getError(nn), nn, ERROR_TYPE)
        return nn
      }, '')
    }
  }

  insertError(name, index, error) {
    insertValue(this.$errors, name, index, error)
  }

  spliceError(name, index) {
    spliceValue(this.$errors, name, index)
  }

  getRule(name) {
    if (!this.rules) return []
    return deepGet(this.rules, name) || []
  }

  getValue() {
    return fastClone(this.$values)
  }

  setValue(values = {}, forcePass) {
    this.$values = values

    Object.keys(this.$inputNames).sort((a, b) => a.length - b.length).forEach((name) => {
      this.dispatch(updateSubscribe(name), this.get(name), name, forcePass)
      this.dispatch(changeSubscribe(name))
    })

    this.dispatch(CHANGE_TOPIC)
  }

  throughError(path, error) {
    const names = []
    if (isObject(error)) {
      Object.keys(error).forEach((name) => {
        names.push([`${path}${path ? '.' : ''}${name}`, name])
      })
    } else if (Array.isArray(error)) {
      error.forEach((n, i) => names.push([`${path}[${i}]`, i]))
    }

    names.forEach(([name, next]) => {
      if (this.$inputNames[name]) this.dispatch(errorSubscribe(name), this.getError(name), name, ERROR_TYPE)
      else this.throughError(name, error[next])
    })
  }

  bind(name, fn, value, validate) {
    if (this.$inputNames[name]) {
      console.warn(`There is already an item with name "${name}" exists. The name props must be unique.`)
    }

    if (value !== undefined && !this.get(name)) {
      this.set(name, value)
      this.dispatch(changeSubscribe(name))
      this.dispatch(CHANGE_TOPIC)
    }

    if (value) this.$defaultValues[name] = fastClone(value)

    this.$validator[name] = validate
    this.$inputNames[name] = true
    this.subscribe(updateSubscribe(name), fn)
    this.subscribe(errorSubscribe(name), fn)
  }

  unbind(name) {
    if (Array.isArray(name)) {
      name.forEach(n => this.unbind(n))
      return
    }

    this.unsubscribe(updateSubscribe(name))
    this.unsubscribe(errorSubscribe(name))
    delete this.$inputNames[name]
    delete this.$validator[name]
    delete this.$errors[name]
    delete this.$defaultValues[name]

    deepRemove(this.$values, name)
  }

  dispatch(name, ...args) {
    const event = this.$events[name]
    if (!event) return
    event.forEach(fn => fn(...args))
  }

  subscribe(name, fn) {
    if (!this.$events[name]) this.$events[name] = []
    const events = this.$events[name]
    if (fn in events) return
    events.push(fn)
  }

  unsubscribe(name, fn) {
    if (!this.$events[name]) return
    this.$events[name] = this.$events[name].filter(e => e !== fn)
  }

  validate() {
    return new Promise((resolve, reject) => {
      const keys = Object.keys(this.$validator)
      const values = this.getValue()

      const validates = [
        ...keys.map(k => this.$validator[k](this.get(k), values)),
        ...(this.$events[VALIDATE_TOPIC] || []).map(fn => fn()),
      ]

      Promise.all(validates).then((res) => {
        const error = res.find(r => r !== true)
        if (error === undefined) resolve(true)
        else reject(error)
      }).catch((e) => {
        reject(new FormError(e))
      })
    })
  }

  validateFieldsByName(name) {
    if (!name || typeof name !== 'string') {
      return Promise.reject(new Error(`Name expect a string, get "${name}"`))
    }

    const validations = []
    const values = this.getValue()
    Object.keys(this.$validator).forEach((n) => {
      if (n === name || n.indexOf(name) === 0) {
        validations.push(this.$validator[n](this.get(n), values))
      }
    })

    return promiseAll(validations)
  }

  validateFields(names) {
    if (!Array.isArray(names)) names = [names]
    const values = this.getValue()
    const validates = []
    names.forEach((k) => {
      if (this.$validator[k]) {
        validates.push(this.$validator[k](this.get(k), values))
      }
    })
    return promiseAll(validates)
  }

  validateClear() {
    const keys = Object.keys(this.$validator)
    this.$errors = {}
    const validates = keys.map(k => this.$validator[k](FORCE_PASS))
    Promise.all(validates)
  }
}
