import React from 'react'
import PropTypes from 'prop-types'
import { Input, Form } from 'shineout'
import { consumer } from './context'
import config from './config'
import { compose } from '../../../src/utils/func'
import { button } from '../../../src/utils/expose'

const { Item } = Form

function ButtonEditor(props) {
  const { button: buttonGetter = {} } = props.config
  const { open, title, onChange } = props
  return (
    <div>
      <h2 className="picker-title">{title}</h2>
      {open && (
        <Form labelWidth={200} value={buttonGetter} onChange={onChange}>
          {Object.keys(buttonGetter).map(name => (
            <Item key={name} label={`${name}: `}>
              <Input.Number name={name} min={0} digits={0} />
            </Item>
          ))}
        </Form>
      )}
    </div>
  )
}

ButtonEditor.propTypes = {
  config: PropTypes.object,
  open: PropTypes.bool,
  title: PropTypes.string,
  onChange: PropTypes.func,
}

export default compose(
  consumer,
  config('button', button)
)(ButtonEditor)
