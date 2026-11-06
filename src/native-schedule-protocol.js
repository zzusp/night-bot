// Derived from DeepSeek dsh-schedule 0.2.1-alpha.2 (MIT).
// Copyright (c) 2026 DeepSeek. See licenses/dsh-schedule-MIT.txt.
// Calendar/format algorithms only; native Host storage and Pi own active lifecycles.
import {Temporal} from '@js-temporal/polyfill'
import {z as z$1} from 'zod'
import {MessageId} from './native-message-protocol.js'
import {defineDomain,domainTable} from './native-domain.js'
import {isDeepStrictEqual} from 'node:util'
// Schedule target IDs are strings validated by this module, with no Session runtime.
const scheduleSessionId=value=>value
//#region lib/types/domain.js
/**
* Strict Schedule decoding, replay, time validation, and framing.
* @module @deepseek-ai/dsh-schedule
*/
/** Durable Schedule protocol version implemented by this package. */
const SCHEDULE_CHANGE_VERSION = 1;
/** Fixed v1 lower bound for a fixed-rate reminder. */
const MIN_EVERY_INTERVAL_SECONDS = 60;
/** Fixed v1 upper bound for a stored task title. */
const MAX_TITLE_LENGTH = 120;
const MIN_FOUR_DIGIT_YEAR_MS = Date.parse("0001-01-01T00:00:00.000Z");
const MAX_FOUR_DIGIT_YEAR_MS = Date.parse("9999-12-31T23:59:59.999Z");
const UTC_INSTANT = /^(?!0000)\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{3}Z$/;
const OFFSET_INSTANT = new RegExp(String.raw`^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})` + String.raw`T(?<hour>\d{2}):(?<minute>\d{2}):(?<second>\d{2})` + String.raw`(?:\.(?<fraction>\d{1,3}))?(?<zone>Z|(?<sign>[+-])` + String.raw`(?<offsetHour>\d{2}):(?<offsetMinute>\d{2}))$`);
const LOCAL_DATE = /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})$/;
const LOCAL_TIME = /^(?<hour>\d{2}):(?<minute>\d{2}):(?<second>\d{2})(?:\.(?<fraction>\d{1,3}))?$/;
const LOCAL_CLOCK_TIME = /^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?$/;
const IANA_ZONE = /^[A-Za-z][A-Za-z0-9_+.-]*(?:\/[A-Za-z0-9_+.-]+)+$/;
/** Error from malformed or transition-invalid durable Schedule data. */
var ScheduleLogError = class extends Error {
	/** Stable machine-readable error code. */
	code = "corrupt_schedule_log";
	/**
	* Construct a durable-log failure.
	* @param message - Package-specific violated invariant.
	*/
	constructor(message) {
		super(message);
		this.name = "ScheduleLogError";
	}
};
/** Error from a model-supplied Schedule rule or target Session that cannot become a record. */
var ScheduleInputError = class extends Error {
	/** Stable public Schedule input code. */
	code;
	/**
	* Construct a stable input failure.
	* @param code - Public Schedule error discriminator.
	* @param message - Stable public diagnostic.
	* @param options - Optional contained implementation cause.
	*/
	constructor(code, message, options) {
		super(message, options);
		this.name = "ScheduleInputError";
		this.code = code;
	}
};
/**
* Brand a raw session-local id without changing its runtime value.
* @param value - Raw session-local id.
* @returns The same string with the Schedule brand.
*/
function ScheduleId(value) {
	return value;
}
/** Whether an unknown value is a non-array object. */
function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
/** Require exactly the named durable object keys. */
function hasExactKeys(value, expected) {
	const allowed = new Set(expected);
	return expected.every((key) => key in value) && Object.keys(value).every((key) => allowed.has(key));
}
/** Require the named durable keys while admitting further optional members. */
function hasExactKeysWithOptional(value, required, optional) {
	const allowed = new Set([...required, ...optional]);
	return required.every((key) => key in value) && Object.keys(value).every((key) => allowed.has(key));
}
/** Stable diagnostic for a title that is missing or empty after trimming. */
const REQUIRED_TITLE_MESSAGE = "title is required and must be non-empty after trimming.";
/**
* Validate the title supplied at creation.
*
* Creation requires an explicit title: a missing, blank-after-trim, or over-long
* value throws instead of deriving a name from the instruction.
* @param title - Task name supplied at creation.
* @returns The trimmed title; an invalid title throws ScheduleInputError.
*/
function scheduleTitle(title) {
	if (typeof title !== "string" || title.trim().length === 0) throw new ScheduleInputError("invalid_prompt", REQUIRED_TITLE_MESSAGE);
	const normalized = title.trim();
	if (normalized.length > 120) throw new ScheduleInputError("invalid_prompt", `title must be at most 120 characters.`);
	return normalized;
}
/**
* Validate one required stored title at the durable boundary.
*
* Only records written after titles became required are read: a missing,
* blank-after-trim, untrimmed, or over-long stored title is invalid, and no name
* is derived from the instruction.
* @param value - Untrusted durable title field.
* @returns The stored title; an invalid title throws ScheduleLogError.
*/
function decodeStoredTitle(value) {
	if (typeof value !== "string" || value.trim().length === 0) throw new ScheduleLogError(REQUIRED_TITLE_MESSAGE);
	if (value.length > 120) throw new ScheduleLogError(`title must be at most 120 characters`);
	if (value.trim() !== value) throw new ScheduleLogError("title must be a trimmed string");
	return value;
}
/**
* Decode the required stored title of one durable Host record, then require its exact key set.
*
* The title decodes first so that a record without the key reports the title
* diagnostic rather than the record's required-key list.
* @param value - Untrusted durable record already known to be an object.
* @param expected - Exact keys the record must carry, including `title`.
* @param message - Diagnostic naming the record's required keys.
* @returns The stored title; an invalid title or key set throws ScheduleLogError.
*/
function decodeRecordTitle(value, expected, message) {
	const title = decodeStoredTitle(value["title"]);
	if (!hasExactKeys(value, expected)) throw new ScheduleLogError(message);
	return title;
}
/**
* Decode the stored title of one historical `schedule/change` create record.
*
* A version-1 event written before names existed has no `title` member, so the
* key set is required without it and the absent member decodes as undefined. A
* present title stays subject to the canonical stored form.
* @param value - Untrusted durable record already known to be an object.
* @param expected - Exact keys the record may carry; `title` is optional within them.
* @param message - Diagnostic naming the record's keys.
* @returns The stored title, or undefined when the historical record predates it.
*/
function decodeHistoricalRecordTitle(value, expected, message) {
	if (!hasExactKeysWithOptional(value, expected.filter((key) => key !== "title"), ["title"])) throw new ScheduleLogError(message);
	return value["title"] === void 0 ? void 0 : decodeStoredTitle(value["title"]);
}
/** Validate one stable session-local id at the durable boundary. */
function decodeId(value) {
	if (typeof value !== "string" || value.length === 0 || value.trim() !== value) throw new ScheduleLogError("schedule id must be a non-empty string without surrounding whitespace");
	return ScheduleId(value);
}
/** Validate one canonical four-digit-year UTC instant. */
function decodeInstant(value) {
	if (typeof value !== "string" || !UTC_INSTANT.test(value)) throw new ScheduleLogError("scheduledAt must be a canonical four-digit-year RFC 3339 UTC instant");
	const epoch = Date.parse(value);
	if (!Number.isFinite(epoch) || new Date(epoch).toISOString() !== value) throw new ScheduleLogError("scheduledAt is not a real UTC calendar instant");
	return value;
}
/** Read one required named regular-expression group as a number. */
function groupNumber(groups, name) {
	const value = groups[name];
	/* v8 ignore next -- successful fixed regexes always provide every requested group. */
	if (value === void 0) throw new ScheduleInputError("invalid_rule", "The at value has an invalid shape.");
	return Number(value);
}
/** Convert exact calendar fields to a UTC-shaped epoch while rejecting normalization. */
function calendarEpoch(parts) {
	const value = /* @__PURE__ */ new Date(0);
	value.setUTCHours(0, 0, 0, 0);
	value.setUTCFullYear(parts.year, parts.month - 1, parts.day);
	value.setUTCHours(parts.hour, parts.minute, parts.second, parts.millisecond);
	const epoch = value.getTime();
	if (!Number.isFinite(epoch) || value.getUTCFullYear() !== parts.year || value.getUTCMonth() + 1 !== parts.month || value.getUTCDate() !== parts.day || value.getUTCHours() !== parts.hour || value.getUTCMinutes() !== parts.minute || value.getUTCSeconds() !== parts.second || value.getUTCMilliseconds() !== parts.millisecond) throw new ScheduleInputError("invalid_rule", "The at value must be a real ISO calendar date and time.");
	return epoch;
}
/** Normalize an optional one-to-three digit fractional second to milliseconds. */
function milliseconds(value) {
	return value === void 0 ? 0 : Number(value.padEnd(3, "0"));
}
/** Require a safe, representable, strictly future UTC target. */
function futureInstant(epoch, now) {
	if (!Number.isSafeInteger(now) || !Number.isSafeInteger(epoch) || epoch < MIN_FOUR_DIGIT_YEAR_MS || epoch > MAX_FOUR_DIGIT_YEAR_MS) throw new ScheduleInputError("time_out_of_range", "The scheduled time must be representable as a four-digit-year RFC 3339 UTC instant.");
	if (epoch <= now) throw new ScheduleInputError("not_future", "The scheduled time must be strictly in the future.");
	const instant = new Date(epoch).toISOString();
	/* v8 ignore next -- an in-range integral Date always formats as the canonical UTC profile. */
	if (!UTC_INSTANT.test(instant)) throw new ScheduleInputError("time_out_of_range", "The scheduled time must be representable as a four-digit-year RFC 3339 UTC instant.");
	return instant;
}
/** Parse a strict RFC 3339 instant whose numeric offset is part of the input. */
function parseOffsetInstant(value) {
	const groups = OFFSET_INSTANT.exec(value)?.groups;
	if (groups === void 0) throw new ScheduleInputError("invalid_rule", "at must use YYYY-MM-DDTHH:mm:ss with optional 1-3 digit fractional seconds and an explicit Z or numeric offset.");
	const parts = {
		year: groupNumber(groups, "year"),
		month: groupNumber(groups, "month"),
		day: groupNumber(groups, "day"),
		hour: groupNumber(groups, "hour"),
		minute: groupNumber(groups, "minute"),
		second: groupNumber(groups, "second"),
		millisecond: milliseconds(groups["fraction"])
	};
	if (parts.year === 0 || parts.hour > 23 || parts.minute > 59 || parts.second > 59) throw new ScheduleInputError("invalid_rule", "The at value must be a real ISO calendar date and time.");
	const localEpoch = calendarEpoch(parts);
	if (groups["zone"] === "Z") return localEpoch;
	const offsetHour = groupNumber(groups, "offsetHour");
	const offsetMinute = groupNumber(groups, "offsetMinute");
	if (offsetHour > 23 || offsetMinute > 59 || groups["sign"] === "-" && offsetHour === 0 && offsetMinute === 0) throw new ScheduleInputError("invalid_rule", "The at numeric offset is invalid.");
	return localEpoch - (groups["sign"] === "+" ? 1 : -1) * (offsetHour * 60 + offsetMinute) * 6e4;
}
/**
* Validate and canonicalize one raw IANA time-zone selector.
* @param value - Candidate `UTC` or IANA Area/Location name.
* @returns The runtime's canonical IANA name.
*/
function canonicalizeTimeZone(value) {
	if (value.length === 0 || value.trim() !== value || value !== "UTC" && !IANA_ZONE.test(value)) throw new ScheduleInputError("invalid_time_zone", "time_zone must be UTC or a valid IANA Area/Location name.");
	let canonical;
	try {
		canonical = new Intl.DateTimeFormat("en-US", { timeZone: value }).resolvedOptions().timeZone;
	} catch (error) {
		throw new ScheduleInputError("invalid_time_zone", "time_zone must be UTC or a valid IANA Area/Location name.", { cause: error });
	}
	/* v8 ignore next -- Intl returns the requested canonical zone or an IANA canonical alias. */
	if (canonical !== "UTC" && !IANA_ZONE.test(canonical)) throw new ScheduleInputError("invalid_time_zone", "time_zone must resolve to UTC or an IANA Area/Location name.");
	return canonical;
}
/** Parse strict local calendar fields without consulting a process time zone. */
function parseLocalAt(value) {
	const dateMatch = LOCAL_DATE.exec(value.date);
	const timeMatch = LOCAL_TIME.exec(value.time);
	const date = dateMatch?.groups;
	const time = timeMatch?.groups;
	if (date === void 0 || time === void 0) throw new ScheduleInputError("invalid_rule", "Local at requires date YYYY-MM-DD and time HH:mm:ss with optional one-to-three digit milliseconds.");
	const parts = {
		year: groupNumber(date, "year"),
		month: groupNumber(date, "month"),
		day: groupNumber(date, "day"),
		hour: groupNumber(time, "hour"),
		minute: groupNumber(time, "minute"),
		second: groupNumber(time, "second"),
		millisecond: milliseconds(time["fraction"])
	};
	if (parts.year === 0 || parts.hour > 23 || parts.minute > 59 || parts.second > 59) throw new ScheduleInputError("invalid_rule", "The local at value must be a real ISO calendar date and time.");
	calendarEpoch(parts);
	return parts;
}
/** Resolve only the earlier overlap instant; a gap fails the local-field round trip. */
function localInstant(local, timeZone) {
	const zoned = local.toZonedDateTime(timeZone, { disambiguation: "earlier" });
	return zoned.toPlainDateTime().equals(local) ? zoned.epochMilliseconds : void 0;
}
/** Resolve a local one-shot, rejecting nonexistent wall-clock times. */
function resolveLocalInstant(parts, timeZone) {
	const target = localInstant(Temporal.PlainDateTime.from(parts, { overflow: "reject" }), timeZone);
	if (target === void 0) throw new ScheduleInputError("invalid_rule", "The local at time does not exist in the selected time zone.");
	return target;
}
/** Decode the exact v1 after record shape. */
function decodeAfterRecord(value) {
	/* v8 ignore next -- decodeLegacyScheduleRecord rejects a non-object before it dispatches here. */
	if (!isRecord(value)) throw new ScheduleLogError("after schedule must be an object");
	const title = decodeHistoricalRecordTitle(value, [
		"id",
		"kind",
		"title",
		"prompt",
		"afterSeconds",
		"scheduledAt"
	], "after schedule must contain exactly id, kind, title, prompt, afterSeconds, and scheduledAt");
	const prompt = value["prompt"];
	if (typeof prompt !== "string" || prompt.length === 0 || prompt.trim() !== prompt) throw new ScheduleLogError("after prompt must be non-empty and already trimmed");
	const afterSeconds = value["afterSeconds"];
	if (!Number.isSafeInteger(afterSeconds) || afterSeconds <= 0) throw new ScheduleLogError("afterSeconds must be a positive safe integer");
	return Object.freeze({
		id: decodeId(value["id"]),
		kind: "after",
		...title === void 0 ? {} : { title },
		prompt,
		afterSeconds,
		scheduledAt: decodeInstant(value["scheduledAt"])
	});
}
/** Decode the exact v1 absolute one-shot record shape. */
function decodeAtRecord(value) {
	/* v8 ignore next -- decodeLegacyScheduleRecord rejects a non-object before it dispatches here. */
	if (!isRecord(value)) throw new ScheduleLogError("at schedule must be an object");
	const title = decodeHistoricalRecordTitle(value, [
		"id",
		"kind",
		"title",
		"prompt",
		"scheduledAt"
	], "at schedule must contain exactly id, kind, title, prompt, and scheduledAt");
	const prompt = value["prompt"];
	if (typeof prompt !== "string" || prompt.length === 0 || prompt.trim() !== prompt) throw new ScheduleLogError("at prompt must be non-empty and already trimmed");
	return Object.freeze({
		id: decodeId(value["id"]),
		kind: "at",
		...title === void 0 ? {} : { title },
		prompt,
		scheduledAt: decodeInstant(value["scheduledAt"])
	});
}
/** Decode the exact v1 fixed-rate record shape. */
function decodeEveryRecord(value) {
	/* v8 ignore next -- decodeLegacyScheduleRecord rejects a non-object before it dispatches here. */
	if (!isRecord(value)) throw new ScheduleLogError("every schedule must be an object");
	const title = decodeHistoricalRecordTitle(value, [
		"id",
		"kind",
		"title",
		"prompt",
		"everySeconds",
		"scheduledAt"
	], "every schedule must contain exactly id, kind, title, prompt, everySeconds, and scheduledAt");
	const prompt = value["prompt"];
	if (typeof prompt !== "string" || prompt.length === 0 || prompt.trim() !== prompt) throw new ScheduleLogError("every prompt must be non-empty and already trimmed");
	const everySeconds = value["everySeconds"];
	const interval = typeof everySeconds === "number" ? everySeconds * 1e3 : NaN;
	if (!Number.isSafeInteger(everySeconds) || everySeconds < 60 || !Number.isSafeInteger(interval)) throw new ScheduleLogError(`everySeconds must be a safe integer of at least 60`);
	return Object.freeze({
		id: decodeId(value["id"]),
		kind: "every",
		...title === void 0 ? {} : { title },
		prompt,
		everySeconds,
		scheduledAt: decodeInstant(value["scheduledAt"])
	});
}
/**
* Parse one strict local clock time shared by the wall-clock selectors.
* @param value - Candidate `HH:mm:ss` time with optional one-to-three fractional digits.
* @param selector - Public selector name used in the diagnostic.
* @returns The parsed plain time; malformed input throws ScheduleInputError.
*/
function localClockTime(value, selector) {
	if (!LOCAL_CLOCK_TIME.test(value)) throw new ScheduleInputError("invalid_rule", `${selector}.time must use HH:mm:ss with optional 1-3 fractional digits, without leap seconds or 24:00.`);
	return Temporal.PlainTime.from(value);
}
/** Parse strictly before Temporal can constrain or coerce the supplied time. */
function dailyTime(value) {
	return localClockTime(value, "daily");
}
/**
* Parse one strict local clock time accepted by the weekly selector.
* @param value - Candidate `HH:mm:ss` time with optional one-to-three fractional digits.
* @returns The parsed plain time; malformed input throws ScheduleInputError.
*/
function weeklyTime(value) {
	return localClockTime(value, "weekly");
}
/** Fail already-typed durable values without wrapping the stored-data diagnostic. */
function rethrowLogError(error) {
	/* v8 ignore next -- every wrapped call raises ScheduleInputError, so this pass-through never fires. */
	if (error instanceof ScheduleLogError) throw error;
	throw new ScheduleLogError(String(error));
}
/** Decode a Host daily rule without re-resolving its committed UTC target. */
function decodeDailyRecord(value) {
	const title = decodeRecordTitle(value, [
		"id",
		"kind",
		"title",
		"prompt",
		"time",
		"timeZone",
		"scheduledAt"
	], "daily schedule must contain exactly id, kind, title, prompt, time, timeZone, and scheduledAt");
	const prompt = value["prompt"];
	if (typeof prompt !== "string" || prompt.length === 0 || prompt.trim() !== prompt) throw new ScheduleLogError("daily prompt must be non-empty and already trimmed");
	const time = value["time"];
	const timeZone = value["timeZone"];
	if (typeof time !== "string" || typeof timeZone !== "string") throw new ScheduleLogError("daily time and timeZone must be strings");
	let normalized;
	try {
		normalized = dailyTime(time).toString({ fractionalSecondDigits: 3 });
		canonicalizeTimeZone(timeZone);
	} catch (error) {
		rethrowLogError(error);
	}
	if (time !== normalized) throw new ScheduleLogError("daily time must be normalized to HH:mm:ss.SSS");
	return Object.freeze({
		id: decodeId(value["id"]),
		kind: "daily",
		title,
		prompt,
		time,
		timeZone,
		scheduledAt: decodeInstant(value["scheduledAt"])
	});
}
/**
* Normalize the explicit ISO weekday set of one weekly rule.
* @param weekdays - Untrusted candidate weekday values.
* @returns Frozen unique ascending weekdays from 1 (Monday) through 7 (Sunday).
*/
function normalizeWeekdays(weekdays) {
	if (!Array.isArray(weekdays) || weekdays.length === 0) throw new ScheduleInputError("invalid_rule", "weekly.weekdays must be a non-empty array of ISO weekday numbers.");
	const unique = /* @__PURE__ */ new Set();
	for (const weekday of weekdays) {
		if (typeof weekday !== "number" || !Number.isInteger(weekday) || weekday < 1 || weekday > 7) throw new ScheduleInputError("invalid_rule", "Each weekly.weekdays entry must be an integer from 1 (Monday) through 7 (Sunday).");
		if (unique.has(weekday)) throw new ScheduleInputError("invalid_rule", `weekly.weekdays must not repeat weekday ${weekday}.`);
		unique.add(weekday);
	}
	const ordered = [...unique].sort((left, right) => left - right);
	Object.freeze(ordered);
	return ordered;
}
/**
* Decode a Host weekly rule without re-resolving its committed UTC target.
* @param value - Untrusted durable record already identified as weekly.
* @returns Detached frozen weekly record; malformed fields throw ScheduleLogError.
*/
function decodeWeeklyRecord(value) {
	const title = decodeRecordTitle(value, [
		"id",
		"kind",
		"title",
		"prompt",
		"time",
		"timeZone",
		"weekdays",
		"scheduledAt"
	], "weekly schedule must contain exactly id, kind, title, prompt, time, timeZone, weekdays, and scheduledAt");
	const prompt = value["prompt"];
	if (typeof prompt !== "string" || prompt.length === 0 || prompt.trim() !== prompt) throw new ScheduleLogError("weekly prompt must be non-empty and already trimmed");
	const time = value["time"];
	const timeZone = value["timeZone"];
	if (typeof time !== "string" || typeof timeZone !== "string") throw new ScheduleLogError("weekly time and timeZone must be strings");
	try {
		canonicalizeTimeZone(timeZone);
	} catch (error) {
		rethrowLogError(error);
	}
	let normalized;
	try {
		normalized = weeklyTime(time).toString({ fractionalSecondDigits: 3 });
	} catch (error) {
		rethrowLogError(error);
	}
	if (time !== normalized) throw new ScheduleLogError("weekly time must be normalized to HH:mm:ss.SSS");
	const stored = value["weekdays"];
	let weekdays;
	try {
		weekdays = normalizeWeekdays(stored);
	} catch (error) {
		rethrowLogError(error);
	}
	if (weekdays.some((weekday, index) => weekday !== stored[index])) throw new ScheduleLogError("weekly weekdays must be normalized to unique ascending ISO weekday numbers");
	return Object.freeze({
		id: decodeId(value["id"]),
		kind: "weekly",
		title,
		prompt,
		time,
		timeZone,
		weekdays,
		scheduledAt: decodeInstant(value["scheduledAt"])
	});
}
/**
* Decode a Host cron rule without re-resolving its committed UTC target.
* @param value - Untrusted durable record already identified as cron.
* @returns Detached frozen cron record; malformed fields throw ScheduleLogError.
*/
function decodeCronRecord(value) {
	const title = decodeRecordTitle(value, [
		"id",
		"kind",
		"title",
		"prompt",
		"expression",
		"timeZone",
		"scheduledAt"
	], "cron schedule must contain exactly id, kind, title, prompt, expression, timeZone, and scheduledAt");
	const prompt = value["prompt"];
	if (typeof prompt !== "string" || prompt.length === 0 || prompt.trim() !== prompt) throw new ScheduleLogError("cron prompt must be non-empty and already trimmed");
	const expression = value["expression"];
	const timeZone = value["timeZone"];
	if (typeof expression !== "string" || typeof timeZone !== "string") throw new ScheduleLogError("cron expression and timeZone must be strings");
	try {
		canonicalizeTimeZone(timeZone);
	} catch (error) {
		rethrowLogError(error);
	}
	let canonical;
	try {
		canonical = parseCronExpression(expression).expression;
	} catch (error) {
		rethrowLogError(error);
	}
	if (expression !== canonical) throw new ScheduleLogError("cron expression must be canonical");
	return Object.freeze({
		id: decodeId(value["id"]),
		kind: "cron",
		title,
		prompt,
		expression,
		timeZone,
		scheduledAt: decodeInstant(value["scheduledAt"])
	});
}
/**
* Decode a current Host task record, preserving its committed target and stored zone spelling.
*
* Every variant of a stored Host task carries its title, so the historical
* one-shot variants are re-checked for that member after their shape decodes.
* @param value - Untrusted durable JSON record.
* @returns Detached frozen record; malformed fields throw ScheduleLogError.
*/
function decodeScheduleRecord(value) {
	if (isRecord(value) && value["kind"] === "daily") return decodeDailyRecord(value);
	if (isRecord(value) && value["kind"] === "weekly") return decodeWeeklyRecord(value);
	if (isRecord(value) && value["kind"] === "cron") return decodeCronRecord(value);
	const record = decodeLegacyScheduleRecord(value);
	if (record.title === void 0) throw new ScheduleLogError(REQUIRED_TITLE_MESSAGE);
	return record;
}
/**
* Decode only the variants admitted by historical version-1 Session events.
*
* A record written before titles existed decodes without that member, so the
* fold keeps reading a log that the current creation path could not write.
* @param value - Untrusted durable JSON record from a Session event.
* @returns Detached frozen record, without a title when the event omitted it.
*/
function decodeLegacyScheduleRecord(value) {
	if (!isRecord(value)) throw new ScheduleLogError("schedule record must be an object");
	switch (value["kind"]) {
		case "after": return decodeAfterRecord(value);
		case "at": return decodeAtRecord(value);
		case "every": return decodeEveryRecord(value);
		default: throw new ScheduleLogError("v1 schedule kind must be \"after\", \"at\", or \"every\"");
	}
}
/**
* Decode one strict version-1 `schedule/change` payload.
* @param value - Untrusted durable JSON value.
* @returns Detached, frozen Schedule change.
*/
function decodeScheduleChange(value) {
	if (!isRecord(value)) throw new ScheduleLogError("schedule/change payload must be an object");
	if (value["version"] !== 1) throw new ScheduleLogError("schedule/change version must be 1");
	switch (value["operation"]) {
		case "create":
			if (!hasExactKeys(value, [
				"version",
				"operation",
				"schedule"
			])) throw new ScheduleLogError("schedule create must contain exactly version, operation, and schedule");
			return Object.freeze({
				version: 1,
				operation: "create",
				schedule: decodeLegacyScheduleRecord(value["schedule"])
			});
		case "delete":
			if (!hasExactKeys(value, [
				"version",
				"operation",
				"id"
			])) throw new ScheduleLogError("schedule delete must contain exactly version, operation, and id");
			return Object.freeze({
				version: 1,
				operation: "delete",
				id: decodeId(value["id"])
			});
		case "dispatch":
			if (hasExactKeys(value, [
				"version",
				"operation",
				"id"
			])) return Object.freeze({
				version: 1,
				operation: "dispatch",
				id: decodeId(value["id"])
			});
			if (hasExactKeys(value, [
				"version",
				"operation",
				"id",
				"acceptedAt"
			])) return Object.freeze({
				version: 1,
				operation: "dispatch",
				id: decodeId(value["id"]),
				acceptedAt: decodeInstant(value["acceptedAt"])
			});
			throw new ScheduleLogError("schedule dispatch must contain id and optional acceptedAt only");
		default: throw new ScheduleLogError("schedule/change operation must be create, delete, or dispatch");
	}
}
/**
* Resolve one fixed-rate decision without enumerating missed occurrences.
* @param record - Active record whose target is the earliest unaccepted occurrence.
* @param acceptedAt - Wall-clock decision time in epoch milliseconds.
* @returns The latest due occurrence and first strictly future target, if representable.
*/
function resolveEveryOccurrence(record, acceptedAt) {
	const target = Date.parse(record.scheduledAt);
	const interval = record.everySeconds * 1e3;
	if (!Number.isSafeInteger(acceptedAt) || acceptedAt < MIN_FOUR_DIGIT_YEAR_MS || acceptedAt > MAX_FOUR_DIGIT_YEAR_MS) throw new ScheduleLogError("every acceptedAt must be a representable four-digit-year instant");
	if (!Number.isSafeInteger(interval) || interval <= 0) throw new ScheduleLogError("every interval milliseconds must be a positive safe integer");
	if (acceptedAt < target) throw new ScheduleLogError("every dispatch cannot precede the active scheduledAt");
	const occurrence = target + Math.floor((acceptedAt - target) / interval) * interval;
	/* v8 ignore next -- bounded operands and a quotient-derived product stay safe. */
	if (!Number.isSafeInteger(occurrence) || occurrence < target || occurrence > acceptedAt) throw new ScheduleLogError("every occurrence arithmetic must stay within the accepted interval");
	const occurrenceAt = new Date(occurrence).toISOString();
	const next = occurrence + interval;
	if (!Number.isSafeInteger(next) || next > MAX_FOUR_DIGIT_YEAR_MS) return Object.freeze({ occurrenceAt });
	return Object.freeze({
		occurrenceAt,
		nextScheduledAt: new Date(next).toISOString()
	});
}
/** Project an explicit instant into a calendar date in the rule's zone. */
function localDate(epoch, timeZone) {
	return Temporal.Instant.fromEpochMilliseconds(epoch).toZonedDateTimeISO(timeZone).toPlainDate();
}
/** Skip every local date; used by a rule that selects by time alone. */
const EVERY_DATE = () => true;
/** Select the explicit ISO weekdays of one normalized weekly rule. */
function weekdaySet(weekdays) {
	const selected = new Set(weekdays);
	return (date) => selected.has(date.dayOfWeek);
}
/** Find the first actual occurrence after now and, when supplied, after a delivered date. */
function nextMatchingTarget(time, timeZone, now, matches, afterDate) {
	let date = localDate(now, timeZone);
	const lastDate = localDate(MAX_FOUR_DIGIT_YEAR_MS, "UTC").add({ days: 1 });
	if (afterDate !== void 0 && Temporal.PlainDate.compare(date, afterDate) <= 0) date = afterDate.add({ days: 1 });
	for (; Temporal.PlainDate.compare(date, lastDate) <= 0; date = date.add({ days: 1 })) {
		if (!matches(date)) continue;
		const target = localInstant(date.toPlainDateTime(time), timeZone);
		if (target === void 0) continue;
		if (target > MAX_FOUR_DIGIT_YEAR_MS) return void 0;
		if (target >= MIN_FOUR_DIGIT_YEAR_MS && target > now) return new Date(target).toISOString();
	}
}
/** Find the latest actual occurrence at or before a decision without leaving the committed floor. */
function latestDueOccurrence(timeZone, matches, time, acceptedAt, savedTarget) {
	let date = localDate(acceptedAt, "UTC").add({ days: 1 });
	for (;; date = date.subtract({ days: 1 })) {
		if (!matches(date)) continue;
		const candidate = localInstant(date.toPlainDateTime(time), timeZone);
		if (candidate === void 0 || candidate > acceptedAt) continue;
		return Math.max(candidate, savedTarget);
	}
}
/** Resolve a wall-clock rule only when its decision is at a representable four-digit-year instant. */
function acceptedDecision(selector, acceptedAt) {
	if (!Number.isSafeInteger(acceptedAt) || acceptedAt < MIN_FOUR_DIGIT_YEAR_MS || acceptedAt > MAX_FOUR_DIGIT_YEAR_MS) throw new ScheduleLogError(`${selector} acceptedAt must be a representable four-digit-year instant`);
	return acceptedAt;
}
/** Find the first actual daily occurrence after now and, when supplied, after a delivered date. */
function nextDailyTarget(time, timeZone, now, afterDate) {
	return nextMatchingTarget(time, timeZone, now, EVERY_DATE, afterDate);
}
/**
* Resolve a daily decision near the decision's local date, not across its missed history.
* @param record - Daily rule with a committed earliest unaccepted UTC target.
* @param acceptedAt - Explicit wall-clock decision time, at or after the committed target.
* @returns Latest actual due occurrence and the next future occurrence on a later local date.
*/
function resolveDailyOccurrence(record, acceptedAt) {
	const decision = acceptedDecision("daily", acceptedAt);
	const savedTarget = Date.parse(record.scheduledAt);
	if (decision < savedTarget) throw new ScheduleLogError("daily dispatch cannot precede the active scheduledAt");
	const time = dailyTime(record.time);
	const occurrence = latestDueOccurrence(record.timeZone, EVERY_DATE, time, decision, savedTarget);
	const occurrenceAt = new Date(occurrence).toISOString();
	const nextScheduledAt = nextDailyTarget(time, record.timeZone, decision, localDate(occurrence, record.timeZone));
	return Object.freeze(nextScheduledAt === void 0 ? { occurrenceAt } : {
		occurrenceAt,
		nextScheduledAt
	});
}
/**
* Find the first actual weekly occurrence after now and, when supplied, after a delivered date.
* @param time - Normalized local clock time of the rule.
* @param timeZone - Explicit zone interpreting that clock time.
* @param weekdays - Normalized explicit ISO weekdays of the rule.
* @param now - Explicit decision time in epoch milliseconds.
* @param afterDate - Local date of the delivered occurrence, excluded from the search.
* @returns The first strictly future target, or exhaustion as undefined.
*/
function nextWeeklyTarget(time, timeZone, weekdays, now, afterDate) {
	return nextMatchingTarget(time, timeZone, now, weekdaySet(weekdays), afterDate);
}
/**
* Resolve a weekly decision near the decision's local date, not across its missed history.
* @param record - Weekly rule with a committed earliest unaccepted UTC target.
* @param acceptedAt - Explicit wall-clock decision time, at or after the committed target.
* @returns Latest actual due occurrence and the next future occurrence on a selected weekday.
*/
function resolveWeeklyOccurrence(record, acceptedAt) {
	const decision = acceptedDecision("weekly", acceptedAt);
	const savedTarget = Date.parse(record.scheduledAt);
	if (decision < savedTarget) throw new ScheduleLogError("weekly dispatch cannot precede the active scheduledAt");
	const time = weeklyTime(record.time);
	const weekdays = normalizeWeekdays(record.weekdays);
	const occurrence = latestDueOccurrence(record.timeZone, weekdaySet(weekdays), time, decision, savedTarget);
	const occurrenceAt = new Date(occurrence).toISOString();
	const nextScheduledAt = nextWeeklyTarget(time, record.timeZone, weekdays, decision, localDate(occurrence, record.timeZone));
	return Object.freeze(nextScheduledAt === void 0 ? { occurrenceAt } : {
		occurrenceAt,
		nextScheduledAt
	});
}
/**
* Build the local-date predicate of one parsed cron rule under Vixie day-of-month/day-of-week semantics.
*
* The star flag selects the branch only; it never excuses a field's matched values.
* When either field text starts with `*`, a local date must satisfy BOTH fields, so a
* stepped star such as `*` followed by `/2` still restricts the dates it matches. A bare
* `*` matches every value, which makes that field's match always true and degrades the
* AND to the other field, exactly like Vixie's `DOM_STAR`/`DOW_STAR` test. Only when
* neither field text starts with `*` does either field matching suffice.
* @param parsed - Parsed cron rule with canonical field text and matched values.
* @returns Whether one local date matches the rule.
*/
function cronDateMatch(parsed) {
	const months = new Set(parsed.months);
	const daysOfMonth = new Set(parsed.daysOfMonth);
	const daysOfWeek = new Set(parsed.daysOfWeek);
	const dayOfMonthRestricted = !parsed.dayOfMonthStar;
	const dayOfWeekRestricted = !parsed.dayOfWeekStar;
	return (date) => {
		/* v8 ignore next -- both callers pre-filter by month before matching a date. */
		if (!months.has(date.month)) return false;
		const dayOfMonth = daysOfMonth.has(date.day);
		const dayOfWeek = daysOfWeek.has(date.dayOfWeek % 7);
		if (dayOfMonthRestricted && dayOfWeekRestricted) return dayOfMonth || dayOfWeek;
		return dayOfMonth && dayOfWeek;
	};
}
/** Enumerate one parsed cron rule's local times of day in ascending wall-clock order. */
function cronTimes(parsed) {
	const times = [];
	for (const hour of parsed.hours) for (const minute of parsed.minutes) times.push(Temporal.PlainTime.from({
		hour,
		minute
	}));
	return times;
}
/**
* Find the first strictly future cron occurrence without leaving the four-digit UTC year range.
*
* The walk stops at {@link CRON_SEARCH_HORIZON_YEARS} past the floor date when that
* horizon precedes the four-digit ceiling: a rule with no match inside the horizon
* never matches, so its search resolves to exhaustion instead of scanning to the ceiling.
* @param parsed - Parsed cron rule.
* @param timeZone - Explicit zone interpreting its local date and time.
* @param floor - Instant every returned target must exceed.
* @returns The first matching target, or exhaustion as undefined.
*/
function nextCronTarget(parsed, timeZone, floor) {
	const times = cronTimes(parsed);
	const matches = cronDateMatch(parsed);
	const months = new Set(parsed.months);
	const firstDate = localDate(floor, timeZone);
	let date = firstDate;
	const floorTime = Temporal.Instant.fromEpochMilliseconds(floor).toZonedDateTimeISO(timeZone).toPlainTime();
	const ceiling = localDate(MAX_FOUR_DIGIT_YEAR_MS, "UTC").add({ days: 1 });
	const horizon = date.add({ years: 400 });
	const lastDate = Temporal.PlainDate.compare(horizon, ceiling) < 0 ? horizon : ceiling;
	while (Temporal.PlainDate.compare(date, lastDate) <= 0) {
		if (!months.has(date.month)) {
			date = date.add({ months: 1 }).with({ day: 1 });
			continue;
		}
		if (matches(date)) for (const time of times) {
			if (date.equals(firstDate) && Temporal.PlainTime.compare(time, floorTime) < 0) continue;
			const target = localInstant(date.toPlainDateTime(time), timeZone);
			if (target === void 0) continue;
			if (target > MAX_FOUR_DIGIT_YEAR_MS) return void 0;
			if (target >= MIN_FOUR_DIGIT_YEAR_MS && target > floor) return new Date(target).toISOString();
		}
		date = date.add({ days: 1 });
	}
}
/**
* Find the latest matching cron occurrence at or before a decision without leaving the committed floor.
*
* The walk stops at {@link CRON_SEARCH_HORIZON_YEARS} before the decision date when that
* horizon follows the four-digit floor, which is the local date holding that floor instant
* in the rule's own zone: a rule with no match inside the horizon keeps the committed target
* instead of scanning back to the floor, and a candidate before the floor instant is skipped.
* @param parsed - Parsed cron rule.
* @param timeZone - Explicit zone interpreting its local date and time.
* @param decision - Wall-clock decision time in epoch milliseconds.
* @param savedTarget - Committed target that stays due even when current zone data resolves past it.
* @returns The latest due occurrence, or the committed target when no local occurrence is representable.
*/
function latestCronOccurrence(parsed, timeZone, decision, savedTarget) {
	const times = cronTimes(parsed);
	const matches = cronDateMatch(parsed);
	const months = new Set(parsed.months);
	let date = localDate(decision, "UTC").add({ days: 1 });
	const floorDate = localDate(MIN_FOUR_DIGIT_YEAR_MS, timeZone);
	const horizon = date.subtract({ years: 400 });
	const firstDate = Temporal.PlainDate.compare(horizon, floorDate) > 0 ? horizon : floorDate;
	while (Temporal.PlainDate.compare(date, firstDate) >= 0) {
		if (!months.has(date.month)) {
			date = date.with({ day: 1 }).subtract({ days: 1 });
			continue;
		}
		if (matches(date)) {
			const earliest = times.reduce((found, time) => found ?? localInstant(date.toPlainDateTime(time), timeZone), void 0);
			if (earliest !== void 0 && earliest > decision) {
				date = date.subtract({ days: 1 });
				continue;
			}
			for (const time of [...times].reverse()) {
				const candidate = localInstant(date.toPlainDateTime(time), timeZone);
				if (candidate === void 0 || candidate > decision || candidate < MIN_FOUR_DIGIT_YEAR_MS) continue;
				return Math.max(candidate, savedTarget);
			}
		}
		date = date.subtract({ days: 1 });
	}
	return savedTarget;
}
/**
* Resolve a cron decision near the decision's local date, not across its missed history.
* @param record - Cron rule with a committed earliest unaccepted UTC target.
* @param acceptedAt - Explicit wall-clock decision time, at or after the committed target.
* @returns Latest actual due occurrence and the first future occurrence.
*/
function resolveCronOccurrence(record, acceptedAt) {
	const decision = acceptedDecision("cron", acceptedAt);
	const savedTarget = Date.parse(record.scheduledAt);
	if (decision < savedTarget) throw new ScheduleLogError("cron dispatch cannot precede the active scheduledAt");
	const parsed = parseCronExpression(record.expression);
	const occurrence = latestCronOccurrence(parsed, record.timeZone, decision, savedTarget);
	const occurrenceAt = new Date(occurrence).toISOString();
	const nextScheduledAt = nextCronTarget(parsed, record.timeZone, decision);
	return Object.freeze(nextScheduledAt === void 0 ? { occurrenceAt } : {
		occurrenceAt,
		nextScheduledAt
	});
}
/**
* Identify recurring Host records explicitly, excluding both one-shot variants.
* @param record - Current Host schedule record.
* @returns Whether the record uses a recurring rule.
*/
function isRecurringScheduleRecord(record) {
	return record.kind === "every" || record.kind === "daily" || record.kind === "weekly" || record.kind === "cron";
}
/**
* Resolve one due recurring Host record with its rule-specific calendar or interval arithmetic.
* @param record - Due recurring rule.
* @param acceptedAt - Explicit decision time in epoch milliseconds.
* @returns Latest due occurrence and optional future target.
*/
function resolveRecurringOccurrence(record, acceptedAt) {
	switch (record.kind) {
		case "every": return resolveEveryOccurrence(record, acceptedAt);
		case "daily": return resolveDailyOccurrence(record, acceptedAt);
		case "weekly": return resolveWeeklyOccurrence(record, acceptedAt);
		case "cron": return resolveCronOccurrence(record, acceptedAt);
	}
}
/** Apply one decoded dispatch to its exact active record. */
function dispatchedRecord(record, change) {
	const hasAcceptedAt = "acceptedAt" in change;
	if (record.kind !== "every") {
		if (hasAcceptedAt) throw new ScheduleLogError("one-shot dispatch must not contain acceptedAt");
		return;
	}
	if (!hasAcceptedAt) throw new ScheduleLogError("every dispatch must contain acceptedAt");
	const occurrence = resolveEveryOccurrence(record, Date.parse(change.acceptedAt));
	return occurrence.nextScheduledAt === void 0 ? void 0 : Object.freeze({
		...record,
		scheduledAt: occurrence.nextScheduledAt
	});
}
/**
* Apply already-decoded Schedule changes to one complete fold value.
*
* The transition authority for full-log replay. One mutable Map/Set pair spans
* the whole batch; the returned arrays are materialized and frozen once.
* @param folded - complete active records and used-id history before the changes.
* @param changes - strictly decoded durable mutations in log order.
* @returns the complete fold value after every mutation.
*/
function applyScheduleChanges(folded, changes) {
	const active = new Map(folded.active.map((record) => [record.id, record]));
	const seen = new Set(folded.seenIds);
	for (const change of changes) switch (change.operation) {
		case "create":
			if (seen.has(change.schedule.id)) throw new ScheduleLogError(`schedule id ${JSON.stringify(change.schedule.id)} was reused`);
			seen.add(change.schedule.id);
			active.set(change.schedule.id, change.schedule);
			break;
		case "delete":
			if (!active.delete(change.id)) throw new ScheduleLogError(`schedule delete targets inactive id ${JSON.stringify(change.id)}`);
			break;
		case "dispatch": {
			const record = active.get(change.id);
			if (record === void 0) throw new ScheduleLogError(`schedule dispatch targets inactive id ${JSON.stringify(change.id)}`);
			const next = dispatchedRecord(record, change);
			if (next === void 0) active.delete(change.id);
			else active.set(change.id, next);
			break;
		}
		/* v8 ignore next 3 -- decodeScheduleChange returns a closed operation union. */
		default: throw new ScheduleLogError(`unknown decoded schedule change ${String(change)}`);
	}
	return Object.freeze({
		active: Object.freeze([...active.values()]),
		seenIds: Object.freeze([...seen])
	});
}
/**
* Fold the package-owned stream after the durable fork seed boundary.
* @param events - Complete ordered session log or candidate-extended log.
* @param inheritedEventCount - Inherited prefix length excluded from child ownership.
* @returns Active records and all previously used ids.
*/
function foldScheduleEvents(events, inheritedEventCount = 0) {
	if (!Number.isSafeInteger(inheritedEventCount) || inheritedEventCount < 0 || inheritedEventCount > events.length) throw new ScheduleLogError("schedule inheritedEventCount must be within the supplied event log");
	const initial = Object.freeze({
		active: Object.freeze([]),
		seenIds: Object.freeze([])
	});
	const changes = function* () {
		for (const event of events.slice(inheritedEventCount)) if (event.type === "schedule/change") yield decodeScheduleChange(event.data);
	};
	return applyScheduleChanges(initial, changes());
}
/**
* Validate a model after rule and compute its durable target.
* @param id - Already allocated task id.
* @param prompt - Reminder content supplied at creation.
* @param afterSeconds - Requested positive delay.
* @param now - Single rule-acceptance wall-clock sample in epoch milliseconds.
* @param title - Required task name supplied at creation.
* @returns Frozen durable after record.
*/
function createAfterScheduleRecord(id, prompt, afterSeconds, now, title) {
	const normalizedPrompt = prompt.trim();
	if (normalizedPrompt.length === 0) throw new ScheduleInputError("invalid_prompt", "prompt must be non-empty after trimming.");
	if (!Number.isSafeInteger(afterSeconds) || afterSeconds <= 0) throw new ScheduleInputError("invalid_rule", "after_seconds must be a positive safe integer.");
	const target = now + afterSeconds * 1e3;
	return Object.freeze({
		id,
		kind: "after",
		title: scheduleTitle(title),
		prompt: normalizedPrompt,
		afterSeconds,
		scheduledAt: futureInstant(target, now)
	});
}
/**
* Validate an absolute selector and compute its sole durable UTC target.
* @param id - Already allocated task id.
* @param prompt - Reminder content supplied at creation.
* @param at - Explicit-offset instant or structured local calendar value.
* @param now - Single rule-acceptance wall-clock sample in epoch milliseconds.
* @param title - Required task name supplied at creation.
* @returns Frozen durable absolute one-shot record.
*/
function createAtScheduleRecord(id, prompt, at, now, title) {
	const normalizedPrompt = prompt.trim();
	if (normalizedPrompt.length === 0) throw new ScheduleInputError("invalid_prompt", "prompt must be non-empty after trimming.");
	return Object.freeze({
		id,
		kind: "at",
		title: scheduleTitle(title),
		prompt: normalizedPrompt,
		scheduledAt: futureInstant(parseAtInput(at), now)
	});
}
/**
* Parse an absolute selector without requiring it to be future.
* @param at - Explicit-offset instant or strict local calendar input.
* @returns Resolved epoch milliseconds; malformed input throws ScheduleInputError.
*/
function parseAtInput(at) {
	let target;
	if (typeof at === "string") target = parseOffsetInstant(at);
	else if (isRecord(at)) {
		if (!hasExactKeys(at, [
			"date",
			"time",
			"time_zone"
		])) throw new ScheduleInputError("invalid_rule", "Local at must contain exactly date, time, and time_zone.");
		if (typeof at["date"] !== "string" || typeof at["time"] !== "string") throw new ScheduleInputError("invalid_rule", "Local at date and time must be strings.");
		const rawTimeZone = at["time_zone"];
		if (typeof rawTimeZone !== "string") throw new ScheduleInputError("invalid_time_zone", "time_zone must be a string.");
		target = resolveLocalInstant(parseLocalAt({
			date: at["date"],
			time: at["time"],
			time_zone: rawTimeZone
		}), canonicalizeTimeZone(rawTimeZone));
	} else throw new ScheduleInputError("invalid_rule", "at must be an explicit-offset string or local calendar object.");
	return target;
}
/**
* Validate a fixed-rate selector and compute the first target of a new interval anchor.
* @param id - Already allocated task id.
* @param prompt - Reminder content supplied at creation.
* @param everySeconds - Requested fixed safe-integer interval.
* @param now - Single rule-acceptance wall-clock sample in epoch milliseconds.
* @param title - Required task name supplied at creation.
* @returns Frozen durable fixed-rate record.
*/
function createEveryScheduleRecord(id, prompt, everySeconds, now, title) {
	const normalizedPrompt = prompt.trim();
	if (normalizedPrompt.length === 0) throw new ScheduleInputError("invalid_prompt", "prompt must be non-empty after trimming.");
	if (!Number.isSafeInteger(everySeconds)) throw new ScheduleInputError("invalid_rule", "every_seconds must be a safe integer.");
	if (everySeconds < 60) throw new ScheduleInputError("frequency_too_high", `every_seconds must be at least 60.`);
	const target = now + everySeconds * 1e3;
	return Object.freeze({
		id,
		kind: "every",
		title: scheduleTitle(title),
		prompt: normalizedPrompt,
		everySeconds,
		scheduledAt: futureInstant(target, now)
	});
}
/**
* Create a daily wall-clock rule with a strictly future committed UTC target.
* @param id - Already allocated task identity.
* @param prompt - Reminder content supplied at creation.
* @param daily - Strict local time and explicit IANA zone.
* @param now - Single rule-acceptance wall-clock sample in epoch milliseconds.
* @param title - Required task name supplied at creation.
* @returns Frozen daily record; absent future dates throw time_out_of_range.
*/
function createDailyScheduleRecord(id, prompt, daily, now, title) {
	const normalizedPrompt = prompt.trim();
	if (normalizedPrompt.length === 0) throw new ScheduleInputError("invalid_prompt", "prompt must be non-empty after trimming.");
	const { time, timeZone } = parseDailyInput(daily);
	if (!Number.isSafeInteger(now) || now < MIN_FOUR_DIGIT_YEAR_MS || now > MAX_FOUR_DIGIT_YEAR_MS) throw new ScheduleInputError("time_out_of_range", "Daily creation time must be a representable four-digit-year UTC instant.");
	const scheduledAt = nextDailyTarget(dailyTime(time), timeZone, now);
	if (scheduledAt === void 0) throw new ScheduleInputError("time_out_of_range", "No future daily occurrence is representable as a four-digit-year UTC instant.");
	return Object.freeze({
		id,
		kind: "daily",
		title: scheduleTitle(title),
		prompt: normalizedPrompt,
		time,
		timeZone,
		scheduledAt
	});
}
/**
* Normalize a daily selector without calculating a new committed target.
* @param daily - Strict local time and explicit IANA zone.
* @returns Normalized time and canonical zone; malformed input throws ScheduleInputError.
*/
function parseDailyInput(daily) {
	if (!isRecord(daily) || !hasExactKeys(daily, ["time", "time_zone"]) || typeof daily["time"] !== "string") throw new ScheduleInputError("invalid_rule", "daily must contain exactly time and time_zone, with time HH:mm:ss and optional 1-3 fractional digits.");
	if (typeof daily["time_zone"] !== "string") throw new ScheduleInputError("invalid_time_zone", "time_zone must be a string.");
	return {
		time: dailyTime(daily["time"]).toString({ fractionalSecondDigits: 3 }),
		timeZone: canonicalizeTimeZone(daily["time_zone"])
	};
}
/**
* Create a weekly wall-clock rule with a strictly future committed UTC target.
* @param id - Already allocated task identity.
* @param prompt - Reminder content supplied at creation.
* @param weekly - Strict local time, explicit IANA zone, and explicit ISO weekday set.
* @param now - Single rule-acceptance wall-clock sample in epoch milliseconds.
* @param title - Required task name supplied at creation.
* @returns Frozen weekly record; absent future weekdays throw time_out_of_range.
*/
function createWeeklyScheduleRecord(id, prompt, weekly, now, title) {
	const normalizedPrompt = prompt.trim();
	if (normalizedPrompt.length === 0) throw new ScheduleInputError("invalid_prompt", "prompt must be non-empty after trimming.");
	const { time, timeZone, weekdays } = parseWeeklyInput(weekly);
	if (!Number.isSafeInteger(now) || now < MIN_FOUR_DIGIT_YEAR_MS || now > MAX_FOUR_DIGIT_YEAR_MS) throw new ScheduleInputError("time_out_of_range", "Weekly creation time must be a representable four-digit-year UTC instant.");
	const scheduledAt = nextWeeklyTarget(weeklyTime(time), timeZone, weekdays, now);
	if (scheduledAt === void 0) throw new ScheduleInputError("time_out_of_range", "No future weekly occurrence is representable as a four-digit-year UTC instant.");
	return Object.freeze({
		id,
		kind: "weekly",
		title: scheduleTitle(title),
		prompt: normalizedPrompt,
		time,
		timeZone,
		weekdays,
		scheduledAt
	});
}
/**
* Create a cron wall-clock rule with a strictly future committed UTC target.
* @param id - Already allocated task identity.
* @param prompt - Reminder content supplied at creation.
* @param cron - Strict five-field expression and explicit IANA zone.
* @param now - Single rule-acceptance wall-clock sample in epoch milliseconds.
* @param title - Required task name supplied at creation.
* @returns Frozen cron record; absent future occurrences throw time_out_of_range.
*/
function createCronScheduleRecord(id, prompt, cron, now, title) {
	const normalizedPrompt = prompt.trim();
	if (normalizedPrompt.length === 0) throw new ScheduleInputError("invalid_prompt", "prompt must be non-empty after trimming.");
	const { expression, timeZone } = parseCronInput(cron);
	if (!Number.isSafeInteger(now) || now < MIN_FOUR_DIGIT_YEAR_MS || now > MAX_FOUR_DIGIT_YEAR_MS) throw new ScheduleInputError("time_out_of_range", "Cron creation time must be a representable four-digit-year UTC instant.");
	const scheduledAt = nextCronTarget(parseCronExpression(expression), timeZone, now);
	if (scheduledAt === void 0) throw new ScheduleInputError("time_out_of_range", "No future cron occurrence is representable as a four-digit-year UTC instant.");
	return Object.freeze({
		id,
		kind: "cron",
		title: scheduleTitle(title),
		prompt: normalizedPrompt,
		expression,
		timeZone,
		scheduledAt
	});
}
/**
* Normalize a weekly selector without calculating a new committed target.
* @param weekly - Strict local time, explicit IANA zone, and explicit ISO weekday set.
* @returns Normalized time, canonical zone, and unique ascending weekdays; malformed input throws ScheduleInputError.
*/
function parseWeeklyInput(weekly) {
	if (!isRecord(weekly) || !hasExactKeys(weekly, [
		"time",
		"time_zone",
		"weekdays"
	]) || typeof weekly["time"] !== "string") throw new ScheduleInputError("invalid_rule", "weekly must contain exactly time, time_zone, and weekdays, with time HH:mm:ss and optional 1-3 fractional digits.");
	if (typeof weekly["time_zone"] !== "string") throw new ScheduleInputError("invalid_time_zone", "time_zone must be a string.");
	return {
		time: weeklyTime(weekly["time"]).toString({ fractionalSecondDigits: 3 }),
		timeZone: canonicalizeTimeZone(weekly["time_zone"]),
		weekdays: normalizeWeekdays(weekly["weekdays"])
	};
}
const CRON_FIELDS = [
	{
		name: "minute",
		min: 0,
		max: 59,
		canonicalMax: 59
	},
	{
		name: "hour",
		min: 0,
		max: 23,
		canonicalMax: 23
	},
	{
		name: "day-of-month",
		min: 1,
		max: 31,
		canonicalMax: 31
	},
	{
		name: "month",
		min: 1,
		max: 12,
		canonicalMax: 12
	},
	{
		name: "day-of-week",
		min: 0,
		max: 7,
		canonicalMax: 6
	}
];
/** Build the stable diagnostic for one malformed cron field element. */
function invalidCronField(spec, element) {
	return new ScheduleInputError("invalid_rule", `cron.expression ${spec.name} field element ${JSON.stringify(element)} must be *, a value, a-b, */n, a-b/n, or a comma-separated list of those.`);
}
/** Read one in-range cron field value. */
function cronFieldValue(text, spec) {
	const value = Number(text);
	if (!Number.isSafeInteger(value) || value < spec.min || value > spec.max) throw new ScheduleInputError("invalid_rule", `cron.expression ${spec.name} field value ${text} is outside ${spec.min}-${spec.max}.`);
	return value;
}
/** Read one positive cron field step. */
function cronFieldStep(text, spec) {
	const step = Number(text);
	if (!Number.isSafeInteger(step) || step < 1) throw new ScheduleInputError("invalid_rule", `cron.expression ${spec.name} field step must be a positive integer.`);
	return step;
}
/** Expand one comma-separated cron field into its matched value set. */
function cronFieldValues(raw, spec) {
	const matched = /* @__PURE__ */ new Set();
	for (const element of raw.split(",")) {
		if (element.length === 0) throw new ScheduleInputError("invalid_rule", `cron.expression ${spec.name} field must not contain an empty list element.`);
		if (element === "*") {
			for (let value = spec.min; value <= spec.max; value += 1) matched.add(value);
			continue;
		}
		if (element.startsWith("*")) {
			const groups = /^\*\/(?<step>\d+)$/.exec(element)?.groups;
			if (groups === void 0) throw invalidCronField(spec, element);
			const stepText = groups["step"];
			/* v8 ignore next -- a successful fixed regex always provides the step group. */
			if (stepText === void 0) throw invalidCronField(spec, element);
			const step = cronFieldStep(stepText, spec);
			for (let value = spec.min; value <= spec.max; value += step) matched.add(value);
			continue;
		}
		const groups = /^(?<start>\d+)(?:-(?<end>\d+))?(?:\/(?<step>\d+))?$/.exec(element)?.groups;
		if (groups === void 0) throw invalidCronField(spec, element);
		const startText = groups["start"];
		/* v8 ignore next -- a successful fixed regex always provides the start group. */
		if (startText === void 0) throw invalidCronField(spec, element);
		const start = cronFieldValue(startText, spec);
		const end = groups["end"];
		const stepText = groups["step"];
		if (end === void 0) {
			if (stepText !== void 0) throw invalidCronField(spec, element);
			matched.add(start);
			continue;
		}
		const last = cronFieldValue(end, spec);
		if (start > last) throw new ScheduleInputError("invalid_rule", `cron.expression ${spec.name} field range ${start}-${last} is inverted.`);
		const step = stepText === void 0 ? 1 : cronFieldStep(stepText, spec);
		for (let value = start; value <= last; value += step) matched.add(value);
	}
	const values = /* @__PURE__ */ new Set();
	for (const value of matched) values.add(spec.canonicalMax !== spec.max && value === spec.max ? spec.min : value);
	return [...values].sort((left, right) => left - right);
}
/**
* Read one value the encoder already proved present.
* @param values - matched value set the parser always fills.
* @param index - index the caller derived from that set.
* @returns the value at that index.
*/
function cronFieldValueAt(values, index) {
	const value = values[index];
	/* v8 ignore next -- a parsed cron field always matches at least one value. */
	if (value === void 0) throw new ScheduleLogError("cron field encoding requires a non-empty value set");
	return value;
}
/** Encode one matched value set as the shortest equivalent comma-separated cron field.
* @param values - Matched values in ascending order.
* @returns Field text that re-parses to exactly `values`, never spelled with a leading `*`.
*/
function encodeCronField(values) {
	const first = cronFieldValueAt(values, 0);
	if (values.length === 1) return String(first);
	const last = cronFieldValueAt(values, values.length - 1);
	const step = cronFieldValueAt(values, 1) - first;
	let uniform = true;
	for (let index = 2; index < values.length; index += 1) if (cronFieldValueAt(values, index) - cronFieldValueAt(values, index - 1) !== step) {
		uniform = false;
		break;
	}
	if (uniform) {
		if (step === 1) return `${first}-${last}`;
		return `${first}-${last}/${step}`;
	}
	const parts = [];
	let runStart = first;
	for (let index = 1; index < values.length; index += 1) {
		const current = cronFieldValueAt(values, index);
		const previous = cronFieldValueAt(values, index - 1);
		if (current === previous + 1) continue;
		parts.push(runStart === previous ? String(runStart) : `${runStart}-${previous}`);
		runStart = current;
	}
	const final = cronFieldValueAt(values, values.length - 1);
	parts.push(runStart === final ? String(runStart) : `${runStart}-${final}`);
	return parts.join(",");
}
/**
* One uniform walk from a field's minimum, folded exactly as a parsed field folds.
* @param spec - Field range and canonical maximum.
* @param step - Positive step of the walk.
* @returns Ascending values `step` produces from the minimum.
*/
function starWalk(spec, step) {
	const walked = /* @__PURE__ */ new Set();
	for (let value = spec.min; value <= spec.max; value += step) walked.add(spec.canonicalMax !== spec.max && value === spec.max ? spec.min : value);
	return [...walked].sort((left, right) => left - right);
}
/**
* Canonical spelling of a field whose text started with `*`.
*
* Only a `*`-prefixed spelling keeps the star flag, and only the bare star or a star-step
* (a `*` followed by `/n`) admits a leading `*`, so the encoding is the bare star for every
* value, otherwise the widest star-step walk plus any remaining values as a list.
* Re-parsing therefore reproduces both the star flag and the matched set, which is what
* keeps day-of-month/day-of-week AND/OR selection stable across a stored canonical
* expression.
* @param values - Matched values in ascending order.
* @param spec - Field range and canonical maximum.
* @returns Canonical field text that starts with `*`.
*/
function encodeStarCronField(values, spec) {
	if (values.length === spec.canonicalMax - spec.min + 1) return "*";
	const present = new Set(values);
	let bestStep;
	let bestWalk = [];
	for (let step = 1; step <= spec.max - spec.min + 1; step += 1) {
		const walk = starWalk(spec, step);
		if (walk.length > bestWalk.length && walk.every((value) => present.has(value))) {
			bestStep = step;
			bestWalk = walk;
		}
	}
	/* v8 ignore next -- the widest step yields the single minimum, which every `*`-led field matches. */
	if (bestStep === void 0) throw new ScheduleInputError("invalid_rule", `${spec.name} cannot keep a leading \`*\`.`);
	const walked = new Set(bestWalk);
	const remaining = values.filter((value) => !walked.has(value));
	const walkText = `*/${bestStep}`;
	return remaining.length === 0 ? walkText : `${walkText},${encodeCronField(remaining)}`;
}
/**
* Parse one cron field into its matched values, canonical spelling, and star flag.
*
* The star flag tests the field text's first character, which is how Vixie sets
* `DOM_STAR`/`DOW_STAR`: a stepped star (`*` followed by `/2`) is a star although
* it matches half the range, while an explicit full range such as `1-31` is
* restricted. Canonicalization preserves the flag: a `*`-led field keeps a `*`-led
* spelling, and a field that did not start with `*` is never spelled as a star-step.
*/
function parseCronField(raw, spec) {
	const values = cronFieldValues(raw, spec);
	const star = raw.startsWith("*");
	return Object.freeze({
		values: Object.freeze(values),
		canonical: star ? encodeStarCronField(values, spec) : encodeCronField(values),
		star
	});
}
/** Parse and canonicalize one strict five-field cron expression. */
function parseCronExpression(expression) {
	if (typeof expression !== "string" || expression.length === 0 || expression.trim() !== expression) throw new ScheduleInputError("invalid_rule", "cron.expression must be a non-empty trimmed string.");
	const fields = expression.split(/\s+/);
	if (fields.length !== 5) throw new ScheduleInputError("invalid_rule", "cron.expression must contain exactly five whitespace-separated fields: minute hour day-of-month month day-of-week.");
	const [minute, hour, dayOfMonth, month, dayOfWeek] = fields.map((field, index) => {
		const fieldSpec = CRON_FIELDS[index];
		/* v8 ignore next -- the five-field split bounds this index. */
		if (fieldSpec === void 0) throw new ScheduleLogError("cron field specification is missing");
		return parseCronField(field, fieldSpec);
	});
	return Object.freeze({
		expression: [
			minute,
			hour,
			dayOfMonth,
			month,
			dayOfWeek
		].map((field) => field.canonical).join(" "),
		minutes: minute.values,
		hours: hour.values,
		daysOfMonth: dayOfMonth.values,
		months: month.values,
		daysOfWeek: dayOfWeek.values,
		dayOfMonthStar: dayOfMonth.star,
		dayOfWeekStar: dayOfWeek.star
	});
}
/**
* Canonicalize one strict five-field cron expression.
* @param expression - Candidate `minute hour day-of-month month day-of-week` expression.
* @returns The canonical expression; malformed or unsupported input throws ScheduleInputError.
*/
function canonicalizeCronExpression(expression) {
	return parseCronExpression(expression).expression;
}
/**
* Normalize a cron selector without calculating a new committed target.
* @param cron - Strict five-field expression and explicit IANA zone.
* @returns The canonical expression and canonical zone; malformed input throws ScheduleInputError.
*/
function parseCronInput(cron) {
	if (!isRecord(cron) || !hasExactKeys(cron, ["expression", "time_zone"]) || typeof cron["expression"] !== "string") throw new ScheduleInputError("invalid_rule", "cron must contain exactly expression and time_zone, with a five-field cron expression.");
	if (typeof cron["time_zone"] !== "string") throw new ScheduleInputError("invalid_time_zone", "time_zone must be a string.");
	return {
		expression: parseCronExpression(cron["expression"]).expression,
		timeZone: canonicalizeTimeZone(cron["time_zone"])
	};
}
/**
* Derive one execution-local management view.
* @param record - Active durable record.
* @param now - Wall-clock sample used for its timing state.
* @returns Complete Host delivery view.
*/
function scheduleView(record, now) {
	return Object.freeze({
		...record,
		state: now >= Date.parse(record.scheduledAt) ? "overdue" : "scheduled",
		deliveryMode: "host"
	});
}
/** Fixed model-facing origin line shared by one-shot and recurring reminder delivery. */
const SCHEDULED_MESSAGE_FRAMING = "This is a scheduled message from the user";
/**
* Render the fixed model framing for a due reminder.
* @param record - Due active record.
* @returns Stable model-visible text with JSON-escaped dynamic fields.
*/
function renderReminderFraming(record) {
	return [
		"[SCHEDULE REMINDER]",
		SCHEDULED_MESSAGE_FRAMING,
		`schedule_id_json: ${JSON.stringify(record.id)}`,
		`occurrence_at: ${record.scheduledAt}`,
		`reminder_prompt_json: ${JSON.stringify(record.prompt)}`
	].join("\n");
}
/**
* Render one recurring reminder batch in the supplied order.
* @param reminders - Complete admitted batch with one latest occurrence per record.
* @returns Stable model-visible text whose dynamic payload is canonical JSON.
*/
function renderRecurringReminderBatchFraming(reminders) {
	const payload = reminders.map(({ record, occurrenceAt }) => ({
		schedule_id: record.id,
		occurrence_at: occurrenceAt,
		reminder_prompt: record.prompt
	}));
	return [
		"[SCHEDULE REMINDER BATCH]",
		SCHEDULED_MESSAGE_FRAMING,
		`reminders_json: ${JSON.stringify(payload)}`
	].join("\n");
}
//#endregion
//#region lib/types/delivery-history.js
/** Milliseconds in one day, the unit the retention window is stated in. */
const DAY_MS = 864e5;
/**
* Read retained history; missing history exposes only the actual legacy receipt.
* @param task - Immutable stored task.
* @returns Oldest-first retained deliveries without changing storage.
*/
function deliveryHistoryOf(task) {
	return task.deliveryHistory ?? {
		records: task.lastDelivery === void 0 ? [] : [task.lastDelivery],
		earlierRecordsUnavailable: true
	};
}
/**
* Prepare one real inbox acknowledgment for the same task write as its status and target.
* Prunes to the configured window and record cap here, on the only write path: the
* domain publishes one whole-unit document per write, so an unbounded array would
* grow that document with every acknowledgment. The read path states no bound of
* its own, because a whole-unit document over the schema's limits refuses to open.
* @param task - Task supplying the immutable sent prompt and retained history.
* @param receipt - Acknowledgment obtained after successful Session flush.
* @param bounds - Configured retention window and record cap for the appended history.
* @returns Receipt and retained history; the caller publishes them only after task persistence.
*/
function appendDelivery(task, receipt, bounds) {
	const history = deliveryHistoryOf(task);
	const appended = [...history.records, {
		...receipt,
		prompt: task.record.prompt
	}];
	const floor = Date.parse(receipt.deliveredAt) - bounds.days * DAY_MS;
	const retained = appended.filter((record) => Date.parse(record.deliveredAt) >= floor).slice(-bounds.records);
	return {
		lastDelivery: receipt,
		deliveryHistory: {
			records: retained,
			earlierRecordsUnavailable: history.earlierRecordsUnavailable || retained.length !== appended.length,
			earlierRecordsPruned: history.earlierRecordsPruned === true || retained.length !== appended.length
		}
	};
}
/**
* Read one newest-first page in append order, independent of wall-clock ordering.
* @param task - Task already checked against the requested Session binding.
* @param request - Validated explicit page size and optional exclusive message cursor.
* @param retention - Current configured limits shared with the delivery writer.
* @returns Copied delivery records or a cursor-not-found result.
*/
function deliveryHistoryPage(task, request, retention) {
	const history = deliveryHistoryOf(task);
	const end = request.before === void 0 ? history.records.length : history.records.findIndex((record) => record.messageId === request.before);
	if (end === -1) return {
		id: request.id,
		code: "delivery_cursor_not_found"
	};
	const start = Math.max(0, end - request.limit);
	const records = history.records.slice(start, end).reverse().map(({ prompt, ...receipt }) => ({
		...receipt,
		...prompt === void 0 ? {} : { prompt }
	}));
	const oldest = records.at(-1);
	return {
		id: request.id,
		records,
		earlierRecordsUnavailable: history.earlierRecordsUnavailable,
		earlierRecordsPruned: history.earlierRecordsPruned === true,
		retention: { ...retention },
		...oldest !== void 0 && start > 0 ? { nextBefore: oldest.messageId } : {}
	};
}
//#endregion
//#region lib/types/storage.js
/** Durable Host-wide Schedule tasks, independently of Session activation. */
const recordSchema = z$1.unknown().transform((value, context) => {
	try {
		return decodeScheduleRecord(value);
	} catch (error) {
		context.addIssue({
			code: "custom",
			message: String(error)
		});
	}
	return z$1.NEVER;
});
const instantSchema = z$1.iso.datetime({ precision: 3 }).refine((value) => !value.startsWith("0000-"), { message: "Expected a canonical four-digit-year UTC calendar instant" });
const deliveryReceiptSchema = z$1.object({
	scheduledAt: instantSchema,
	deliveredAt: instantSchema,
	messageId: z$1.string().min(1).refine((value) => value.trim() === value).transform(MessageId)
}).strict();
const deliveryHistorySchema = z$1.object({
	records: z$1.array(deliveryReceiptSchema.extend({ prompt: z$1.string().optional() }).strict()),
	earlierRecordsUnavailable: z$1.boolean(),
	earlierRecordsPruned: z$1.boolean().optional()
}).strict().refine((history) => new Set(history.records.map((record) => record.messageId)).size === history.records.length, { message: "Delivery history message identities must be unique within a task" });
/** Authoritative Schedule storage; malformed tasks reject opening the domain. */
const scheduleDomain = defineDomain({
	name: "schedule",
	version: 1,
	tables: { deliveries: domainTable(z$1.object({
        sessionId:z$1.string().min(1).transform(scheduleSessionId),
        acceptedAt:instantSchema,
        queued:z$1.boolean(),
        cancelled:z$1.boolean().optional(),
        packet:z$1.object({id:z$1.string().min(1),source:z$1.object({kind:z$1.literal('schedule'),occurrences:z$1.array(z$1.object({id:z$1.string().min(1),target:instantSchema,occurrenceAt:instantSchema,nextScheduledAt:instantSchema.optional()}).strict()).min(1)}).strict(),content:z$1.array(z$1.object({type:z$1.literal('text'),text:z$1.string()}).strict()).min(1)}).strict()
    }).strict()), tasks: domainTable(z$1.object({
		sessionId: z$1.string().min(1).transform(scheduleSessionId),
		record: recordSchema,
		status: z$1.enum(["active", "inactive"]).default("active"),
		lastDelivery: deliveryReceiptSchema.optional(),
		deliveryHistory: deliveryHistorySchema.optional()
	}).strict().refine((task) => {
		if (task.deliveryHistory === void 0) return true;
		const latest = task.deliveryHistory.records.at(-1);
		if (latest === void 0) return task.lastDelivery === void 0;
		return task.lastDelivery !== void 0 && latest.scheduledAt === task.lastDelivery.scheduledAt && latest.deliveredAt === task.lastDelivery.deliveredAt && latest.messageId === task.lastDelivery.messageId;
	}, { message: "Last delivery must match the latest saved delivery receipt" })) }
});
//#endregion
//#region lib/types/update.js
/** Optimistic name, instruction, and timing updates of retained Host tasks, without Session mutations. */
/** Name the exact selector property each timing kind must carry, or undefined for an unknown discriminant. */
function timingSelector(kind) {
	switch (kind) {
		case "at": return "at";
		case "every": return "every_seconds";
		case "daily": return "daily";
		case "weekly": return "weekly";
		case "cron": return "cron";
		default: return;
	}
}
/**
* Validate the exact timing selector keys received over RPC.
* @param value - Untrusted timing change; the wire can carry a null, array, or foreign discriminant.
* @returns The same value narrowed to the closed timing-change union.
*/
function validateChange(value) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new ScheduleInputError("invalid_rule", "Timing change must be an object with exactly one supported timing selector.");
	const change = value;
	const selector = timingSelector(change.kind);
	const keys = Object.keys(change);
	if (selector === void 0 || keys.length !== 2 || !keys.includes("kind") || !keys.includes(selector)) throw new ScheduleInputError("invalid_rule", "Timing change must contain exactly kind and its matching timing selector.");
	return change;
}
/**
* Validate a replacement instruction received over RPC.
* @param prompt - Untrusted instruction value; the wire can carry a non-string.
* @returns The trimmed instruction; an invalid instruction throws ScheduleInputError.
*/
function schedulePrompt(prompt) {
	if (typeof prompt !== "string" || prompt.trim().length === 0) throw new ScheduleInputError("invalid_prompt", "prompt must be non-empty after trimming.");
	return prompt.trim();
}
/**
* Title one update must either keep or replace.
*
* A decoded record always carries a stored title. A record value without a
* valid one is refused with the durable decode error instead of deriving a name.
* @param record - Current active Host record.
* @returns The stored title; a missing, blank, untrimmed, or over-long title throws ScheduleLogError.
*/
function retainedTitle(record) {
	return decodeStoredTitle(record.title);
}
/**
* Apply a replacement name and instruction to a stored record without touching its rule.
* @param current - Current active record holding the committed target.
* @param title - Validated replacement or retained name.
* @param prompt - Validated replacement or retained instruction.
* @returns The same record when both are unchanged, otherwise a frozen copy with the new content.
*/
function withContent(current, title, prompt) {
	return title === current.title && prompt === current.prompt ? current : Object.freeze({
		...current,
		title,
		prompt
	});
}
/**
* Resolve the requested rule against the current record after the complete expected record has matched.
*
* The change kind may differ from the current record's kind; a change whose normalized
* timing equals the current rule keeps the committed target and only applies the supplied
* name and instruction, while any other change recomputes the target exactly as creation
* computes it from the same now.
*/
function changedRecord(current, title, prompt, value, now) {
	if (value === void 0) return withContent(current, title, prompt);
	const change = validateChange(value);
	switch (change.kind) {
		case "at":
			if ((current.kind === "after" || current.kind === "at") && parseAtInput(change.at) === Date.parse(current.scheduledAt)) return withContent(current, title, prompt);
			return createAtScheduleRecord(current.id, prompt, change.at, now, title);
		case "every":
			if (current.kind === "every" && change.every_seconds === current.everySeconds) return withContent(current, title, prompt);
			return createEveryScheduleRecord(current.id, prompt, change.every_seconds, now, title);
		case "daily":
			if (current.kind === "daily") {
				const normalized = parseDailyInput(change.daily);
				if (normalized.time === current.time && normalized.timeZone === canonicalizeTimeZone(current.timeZone)) return withContent(current, title, prompt);
			}
			return createDailyScheduleRecord(current.id, prompt, change.daily, now, title);
		case "weekly":
			if (current.kind === "weekly") {
				const normalized = parseWeeklyInput(change.weekly);
				if (normalized.time === current.time && normalized.timeZone === canonicalizeTimeZone(current.timeZone) && isDeepStrictEqual(normalized.weekdays, current.weekdays)) return withContent(current, title, prompt);
			}
			return createWeeklyScheduleRecord(current.id, prompt, change.weekly, now, title);
		case "cron":
			if (current.kind === "cron") {
				const normalized = parseCronInput(change.cron);
				if (normalized.expression === canonicalizeCronExpression(current.expression) && normalized.timeZone === canonicalizeTimeZone(current.timeZone)) return withContent(current, title, prompt);
			}
			return createCronScheduleRecord(current.id, prompt, change.cron, now, title);
		/* v8 ignore next 4 -- validateChange rejects unknown discriminants before this closed union switch. */
		default: throw new Error(`Unknown validated timing change: ${String(change)}`);
	}
}
/**
* Compare the complete observed record and resolve one name, instruction, and timing update
* using a single queue-time sample.
*
* An omitted change, name, or instruction keeps the stored value. A supplied name or
* instruction never re-anchors the schedule on its own; an equivalent normalized timing
* change keeps the committed target too.
* @param current - Current active Host record.
* @param expected - Untrusted complete record observed by the caller.
* @param change - Strict timing selector, whose kind may differ from the current record's kind, or undefined to keep timing.
* @param now - Single wall-clock sample from the accepted FIFO slot.
* @param content - Untrusted replacement name and instruction; each omitted field keeps its stored value.
* @returns Current/new record or a bounded input/conflict result; unrelated failures throw.
*/
function resolveScheduleUpdate(current, expected, change, now, content = {}) {
	let decoded;
	try {
		decoded = decodeScheduleRecord(expected);
	} catch (error) {
		if (!(error instanceof ScheduleLogError)) throw error;
		return {
			code: "invalid_rule",
			message: "expected must be a complete valid Schedule record."
		};
	}
	if (!isDeepStrictEqual(current, decoded)) return {
		id: current.id,
		updated: false,
		code: "schedule_conflict"
	};
	try {
		const retained = retainedTitle(current);
		const record = changedRecord(current, content.title === void 0 ? retained : scheduleTitle(content.title), content.prompt === void 0 ? current.prompt : schedulePrompt(content.prompt), change, now);
		return {
			id: current.id,
			updated: record !== current,
			record
		};
	} catch (error) {
		if (!(error instanceof ScheduleInputError)) throw error;
		return {
			code: error.code,
			message: error.message
		};
	}
}
//#endregion
export { MAX_TITLE_LENGTH, MIN_EVERY_INTERVAL_SECONDS, REQUIRED_TITLE_MESSAGE, SCHEDULE_CHANGE_VERSION, ScheduleId, ScheduleInputError, ScheduleLogError, canonicalizeCronExpression, createAfterScheduleRecord, createAtScheduleRecord, createCronScheduleRecord, createDailyScheduleRecord, createEveryScheduleRecord, createWeeklyScheduleRecord, decodeScheduleChange, decodeScheduleRecord, foldScheduleEvents, isRecurringScheduleRecord, normalizeWeekdays, parseCronInput, parseWeeklyInput, renderRecurringReminderBatchFraming, renderReminderFraming, resolveCronOccurrence, resolveDailyOccurrence, resolveEveryOccurrence, resolveRecurringOccurrence, resolveWeeklyOccurrence, scheduleDomain, appendDelivery, deliveryHistoryPage, resolveScheduleUpdate, scheduleTitle, scheduleView, weeklyTime };
