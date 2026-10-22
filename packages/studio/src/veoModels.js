import { createGroupedVideoRegistry } from "./groupedVideoRegistry.js";

const VEO_FAMILY_NAMES = Object.freeze({
  "veo-3.1": "Veo 3.1",
  "veo-3": "Veo 3",
});

const registry = createGroupedVideoRegistry({
  facetOptions: {
    speed: [
      { value: "standard", label: "Standard" },
      { value: "fast", label: "Fast" },
      { value: "lite", label: "Lite" },
    ],
  },
  facetLabels: { speed: "Speed" },
  registerVariants(register) {
    for (const [familyId, prefix, speeds] of [
      ["veo-3", "veo3", ["standard", "fast"]],
      ["veo-3.1", "veo3.1", ["standard", "fast", "lite"]],
    ]) {
      for (const speed of speeds) {
        const stem = `${prefix}${speed === "standard" ? "" : `-${speed}`}`;
        register(`${stem}-text-to-video`, familyId, [null], { speed });
        register(`${stem}-image-to-video`, familyId,
          familyId === "veo-3.1" ? ["animate_image", "keyframes"] : ["animate_image"], { speed });
      }
    }
    register("veo3.1-reference-to-video", "veo-3.1", ["references"]);
  },
});

export const { getConfiguration: getVeoConfiguration } = registry;

export function resolveVeoVariant(options) {
  const { changes = {} } = options;
  if (Object.keys(changes).some((key) => key !== "speed")) return null;
  return registry.resolveVariant({ ...options, changes: changes.speed == null ? {} : changes });
}

export const VEO_MODEL_GROUP = Object.freeze({
  copyKey: "veo",
  familyNames: VEO_FAMILY_NAMES,
  configurations: registry.configurations,
  workflowVariants: registry.workflowVariants,
  resolveVariant: resolveVeoVariant,
  getVariantOptions: registry.getVariantOptions,
});
