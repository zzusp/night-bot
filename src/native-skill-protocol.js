// MIT source-derived skill naming/invocation/rendering protocol; see licenses/dsh-skill-MIT.txt.
import {assertNever} from "./native-values.js";
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** Standard precedence rank for packaged skill providers and local bundled roots. */
const BUNDLED_SKILL_RANK = 600;
/**
* Return whether a string is a valid kebab-case skill name.
* @param name - candidate skill name to validate.
* @returns whether the name matches the public skill-name grammar.
*/
function isSkillName(name) {
	return SKILL_NAME.test(name);
}
/**
* Return whether a skill may be advertised to and loaded by a model.
* @param skill - skill metadata carrying resolved invocation controls.
* @returns whether the policy permits model invocation.
*/
function isModelInvocable(skill) {
	return skill.invocation.modelInvocable;
}
/**
* Return whether a skill may be advertised to and loaded by a human-facing command.
* @param skill - skill metadata carrying resolved invocation controls.
* @returns whether the policy permits user invocation.
*/
function isUserInvocable(skill) {
	return skill.invocation.userInvocable;
}
/**
* Render one loaded skill for the model. The output is shared verbatim by the
* `skill` tool result and the user-explicit invocation injection, so the model
* sees one canonical `<skill_content>` shape on both paths. The name rides an
* escaped attribute; the body is embedded verbatim (skills are trusted local
* content, and user-supplied invocation text stays outside this wrapper).
* @param skill - name, provider, optional resource base, and body to render.
* @returns the complete model-facing `<skill_content>` block.
*/
function renderSkillContent(skill) {
	const resourceHint = renderResourceHint(skill);
	return [
		`<skill_content name="${escapeAttr(skill.name)}">`,
		"<skill_resources>",
		...resourceHint,
		"</skill_resources>",
		"",
		"<skill_instructions>",
		skill.content,
		"</skill_instructions>",
		"</skill_content>"
	].join("\n");
}
function renderResourceHint(skill) {
	const base = skill.resourceBase;
	if (base === void 0) return [`Resources for this skill are managed by provider "${escapeText(skill.provider)}".`, "Load referenced resources only as needed."];
	switch (base.kind) {
		case "directory": return [`Base directory for this skill: ${escapeText(base.path)}`, "Resolve relative paths mentioned by this skill against the base directory before using them. Load referenced resources only as needed."];
		case "url": return [`Base URL for this skill: ${escapeText(base.url)}`, "Resolve relative URLs mentioned by this skill against the base URL before using them. Load referenced resources only as needed."];
		case "opaque": return [`Resources for this skill: ${escapeText(base.description)}`, "Load referenced resources only as needed."];
		/* v8 ignore start -- SkillResourceBase is a closed union; a future kind must fail compilation here. */
		default: return assertNever(base, "SkillResourceBase.kind");
	}
}
function escapeAttr(value) {
	return value.replaceAll("&", "&amp;").replaceAll("\"", "&quot;").replaceAll("<", "&lt;");
}
/**
* Escape model-facing prose embedded inside skill markup so provider-supplied
* text cannot open or close framing tags.
* @param value - raw prose to embed.
* @returns the escaped text.
*/
function escapeText(value) {
	return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export { BUNDLED_SKILL_RANK, escapeText, isModelInvocable, isSkillName, isUserInvocable, renderSkillContent };
