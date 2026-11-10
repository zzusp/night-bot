import {operatorCapability} from '../runtime/operator-capability.js'
export const EFFECT_OPERATOR_TOKEN_FILE='effect-operator.credentials.json'
const capability=operatorCapability({filename:EFFECT_OPERATOR_TOKEN_FILE,prefix:'EFFECT_OPERATOR'})
export const effectOperatorTokenPath=capability.tokenPath
export const readEffectOperatorToken=capability.readToken
export const createEffectOperatorAuth=capability.createAuth
