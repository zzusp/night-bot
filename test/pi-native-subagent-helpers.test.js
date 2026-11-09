import test from 'node:test'
import assert from 'node:assert/strict'
import {canonicalClientTimeZone} from '../src/native-time-zone.js'

test('caller zones accept canonical named zones and reject offsets, aliases and malformed inputs',()=>{
 for(const [input,expected] of [['UTC','UTC'],['Asia/Shanghai','Asia/Shanghai'],['America/New_York','America/New_York'],['Etc/GMT+5','Etc/GMT+5'],['GMT',undefined],[' UTC',undefined],['Invalid/Zone',undefined],['UTC+5',undefined],['',undefined]])assert.equal(canonicalClientTimeZone(input),expected)
})
