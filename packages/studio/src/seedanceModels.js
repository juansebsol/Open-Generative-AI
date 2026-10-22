import { i2vModels, t2vModels, v2vModels } from "./models.js";

// Endpoint coordinates are separate from ordinary generation parameters for
// routes whose schema has no native resolution input.
const FACETS = Object.freeze(["profile", "speed", "resolution"]);
const modelIds = new Set(
  [...t2vModels, ...i2vModels, ...v2vModels].map((model) => model.id),
);
// Models that take a native resolution input never use an implied endpoint size.
const nativeResolutionModelIds = new Set(
  [...t2vModels, ...i2vModels, ...v2vModels].filter((model) => model.inputs?.resolution).map((model) => model.id),
);
const configurations = new Map();

const SEEDANCE_FAMILY_NAMES = Object.freeze({
  "seedance-2.5": "Seedance 2.5",
  "seedance-2": "Seedance 2.0",
  "seedance-1.5": "Seedance 1.5 Pro",
  "seedance-pro": "Seedance 1.0 Pro",
});

const PROFILE_OPTIONS = Object.freeze([
  { value: "standard", label: "Standard" },
  { value: "vip", label: "VIP" },
  { value: "mini", label: "Mini" },
  { value: "legacy", label: "Original" },
]);
const FACET_OPTIONS = Object.freeze({
  profile: PROFILE_OPTIONS,
  speed: [
    { value: "standard", label: "Standard" },
    { value: "fast", label: "Fast" },
  ],
  resolution: [
    { value: "default", label: "Automatic", description: "Uses the model variant’s default resolution." },
    { value: "480p", label: "480p" },
    { value: "1080p", label: "1080p" },
    { value: "4k", label: "4K" },
  ],
});

function register(modelId, familyId, workflowIds, facets = {}) {
  // The service matrix is explicit, but not every version offers every cell.
  // Only endpoints present in the local provider catalog become selectable.
  if (!modelIds.has(modelId)) return;
  configurations.set(modelId, Object.freeze({
    familyId,
    profile: "standard",
    speed: "standard",
    resolution: "default",
    ...facets,
    workflowIds: Object.freeze(workflowIds),
  }));
}

const MODERN_WORKFLOWS = Object.freeze({
  text: { stem: "text-to-video", workflowId: null },
  image: { stem: "image-to-video", workflowId: "animate_image" },
  keyframes: { stem: "first-last-frame", workflowId: "keyframes" },
  references: { stem: "omni-reference", workflowId: "references" },
  edit: { stem: "video-edit", workflowId: "edit_video" },
  extend: { stem: "video-extend", workflowId: "extend_uploaded_video" },
});

for (const { stem, workflowId } of Object.values(MODERN_WORKFLOWS)) {
  for (const resolution of ["default", "480p", "1080p", "4k"]) {
    register(
      `seedance-2.5-${stem}${resolution === "default" ? "" : `-${resolution}`}`,
      "seedance-2.5",
      [workflowId],
      { resolution },
    );
  }
}

for (const profile of ["standard", "vip", "mini"]) {
  const prefix = profile === "standard" ? "" : `${profile}-`;
  const modes = profile === "mini"
    ? ["text", "image", "references"]
    : ["text", "image", "keyframes", "references"];
  for (const mode of modes) {
    const { stem, workflowId } = MODERN_WORKFLOWS[mode];
    const endpointStem = profile === "standard" && mode === "references"
      ? "omni-reference-no-video"
      : stem;
    for (const speed of ["standard", "fast"]) {
      for (const resolution of ["default", "1080p", "4k"]) {
        register(
          `seedance-2-${prefix}${endpointStem}${speed === "fast" ? "-fast" : ""}${resolution === "default" ? "" : `-${resolution}`}`,
          "seedance-2",
          [workflowId],
          { profile, speed, resolution },
        );
      }
    }
  }
}

// Seedance 2.0 extend endpoints take a native resolution input.
register("seedance-2.0-video-extend", "seedance-2", ["extend_uploaded_video"]);
register("seedance-2.0-fast-video-extend", "seedance-2", ["extend_uploaded_video"], { speed: "fast" });
register("seedance-2.0-mini-video-extend", "seedance-2", ["extend_uploaded_video"], { profile: "mini" });

for (const [stem, workflowId] of [
  ["t2v", null],
  ["i2v", "animate_image"],
  ["omni-reference", "references"],
]) {
  register(`seedance-2-${stem}-480p`, "seedance-2", [workflowId], { profile: "legacy", resolution: "480p" });
}

for (const [familyId, prefix] of [
  ["seedance-1.5", "seedance-v1.5-pro"],
  ["seedance-pro", "seedance-pro"],
]) {
  for (const speed of ["standard", "fast"]) {
    const suffix = speed === "fast" ? "-fast" : "";
    register(`${prefix}-t2v${suffix}`, familyId, [null], { speed });
    // Only 1.5 exposes an end-frame input in this catalog.
    register(`${prefix}-i2v${suffix}`, familyId,
      familyId === "seedance-pro" ? ["animate_image"] : ["animate_image", "keyframes"],
      { speed });
    register(`${prefix}-video-extend${suffix}`, familyId, ["extend_uploaded_video"], { speed });
  }
}

export function getSeedanceConfiguration(modelId) {
  return configurations.get(modelId) || null;
}

// The upstream Seedance 2 / 2.5 family docs specify 720p for unsuffixed
// services that do not expose a native resolution input (2026-09-09).
// Older API routes with no documented size deliberately remain unspecified.
export function getSeedanceEndpointResolution(modelId) {
  const config = getSeedanceConfiguration(modelId);
  if (!config || nativeResolutionModelIds.has(modelId)) return undefined;
  if (config.resolution !== "default") return config.resolution;
  if (config.familyId === "seedance-2.5" ||
      (config.familyId === "seedance-2" && ["standard", "vip"].includes(config.profile))) return "720p";
  return undefined;
}

function coordinateKey({ profile, speed, resolution }) {
  return `${profile}\u0000${speed}\u0000${resolution}`;
}

const FACET_LABELS = Object.freeze({
  profile: "Model variant", speed: "Speed", resolution: "Resolution",
});
const EMPTY_OPTIONS = Object.freeze([]);
const profilePriority = new Map(PROFILE_OPTIONS.map((option, index) => [option.value, index]));

function defaultScore(config) {
  return profilePriority.get(config.profile) * 100 +
    (config.speed === "standard" ? 0 : 10) +
    (config.resolution === "default" ? 0 : 1);
}

function buildSelectionIndex() {
  const families = new Map();
  for (const [modelId, config] of configurations) {
    let family = families.get(config.familyId);
    if (!family) {
      family = { workflows: new Map(), coordinates: new Map() };
      families.set(config.familyId, family);
    }
    const key = coordinateKey(config);
    family.coordinates.set(key, config);
    const score = defaultScore(config);
    for (const workflowId of config.workflowIds) {
      let group = family.workflows.get(workflowId);
      if (!group) {
        group = {
          modelIds: [],
          variantByCoordinates: new Map(),
          optionsByCoordinates: new Map(),
          facetValues: Object.fromEntries(FACETS.map((facet) => [facet, new Set()])),
          defaultConfiguration: config,
          defaultScore: score,
        };
        family.workflows.set(workflowId, group);
      }
      group.modelIds.push(modelId);
      if (!group.variantByCoordinates.has(key)) group.variantByCoordinates.set(key, modelId);
      if (score < group.defaultScore) {
        group.defaultConfiguration = config;
        group.defaultScore = score;
      }
      for (const facet of FACETS) group.facetValues[facet].add(config[facet]);
    }
  }

  // Workflows (at most six) and facet values are bounded by the explicit
  // matrices above. Precompute each choice once; rendering only looks it up.
  for (const family of families.values()) {
    for (const group of family.workflows.values()) {
      const fields = FACETS.flatMap((key) => group.facetValues[key].size > 1 ? [{
        key,
        label: FACET_LABELS[key],
        options: FACET_OPTIONS[key].filter((option) => group.facetValues[key].has(option.value)),
      }] : []);
      for (const [coordinates, config] of family.coordinates) {
        const options = fields.map((field) => Object.freeze({
          key: field.key,
          label: field.label,
          value: config[field.key],
          options: Object.freeze(field.options.map((option) => Object.freeze({
            ...option,
            disabled: !group.variantByCoordinates.has(coordinateKey({
              ...config, [field.key]: option.value,
            })),
          }))),
        }));
        group.optionsByCoordinates.set(coordinates, Object.freeze(options));
      }
      delete group.facetValues;
      delete group.defaultScore;
    }
  }
  return families;
}

const selectionIndex = buildSelectionIndex();

const SEEDANCE_WORKFLOW_VARIANTS = Object.freeze(Object.fromEntries(
  [...selectionIndex].map(([familyId, family]) => [familyId, Object.freeze(Object.fromEntries(
    [...family.workflows]
      .filter(([workflowId]) => workflowId !== null)
      .map(([workflowId, group]) => [workflowId, Object.freeze(group.modelIds)]),
  ))]),
));

export function resolveSeedanceVariant({
  familyId,
  workflowId = null,
  currentModelId = null,
  changes = {},
}) {
  if (Object.keys(changes).some((key) => !FACETS.includes(key))) return null;
  const group = selectionIndex.get(familyId)?.workflows.get(workflowId);
  if (!group) return null;
  const current = getSeedanceConfiguration(currentModelId);
  const coordinates = current?.familyId === familyId
    ? current
    : group.defaultConfiguration;
  const requestedKey = coordinateKey({ ...coordinates, ...changes });
  if (current?.familyId === familyId && current.workflowIds.includes(workflowId) &&
      coordinateKey(current) === requestedKey) return currentModelId;
  return group.variantByCoordinates.get(requestedKey) || null;
}

export function getSeedanceVariantOptions(familyId, workflowId = null, currentModelId = null) {
  const group = selectionIndex.get(familyId)?.workflows.get(workflowId);
  if (!group) return EMPTY_OPTIONS;
  const current = getSeedanceConfiguration(currentModelId);
  const selected = current?.familyId === familyId ? current : group.defaultConfiguration;
  return group.optionsByCoordinates.get(coordinateKey(selected));
}

export const SEEDANCE_MODEL_GROUP = Object.freeze({
  copyKey: "seedance",
  familyNames: SEEDANCE_FAMILY_NAMES,
  configurations,
  workflowVariants: SEEDANCE_WORKFLOW_VARIANTS,
  resolveVariant: resolveSeedanceVariant,
  getVariantOptions: getSeedanceVariantOptions,
});
