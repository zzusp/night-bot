import {operatorCapability} from '../runtime/operator-capability.js'
export const SETTINGS_OPERATOR_TOKEN_FILE='settings-operator.credentials.json'
const capability=operatorCapability({filename:SETTINGS_OPERATOR_TOKEN_FILE,prefix:'SETTINGS_OPERATOR'})
export const readSettingsOperatorToken=capability.readToken
export const createSettingsOperatorAuth=capability.createAuth
