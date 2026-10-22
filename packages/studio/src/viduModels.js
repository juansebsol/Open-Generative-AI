import { createGroupedVideoRegistry } from "./groupedVideoRegistry.js";

const VIDU_FAMILY_NAMES = Object.freeze({
  "vidu-q4": "Vidu Q4",
  "vidu-q3": "Vidu Q3",
  "vidu-q2": "Vidu Q2",
  "vidu-q1": "Vidu Q1",
});

const registry = createGroupedVideoRegistry({
  facetOptions: {
    speed: [
      { value: "standard", label: "Standard speed" },
      { value: "fast", label: "Fast" },
    ],
  },
  facetLabels: { speed: "Speed" },
  registerVariants(register) {
    for (const version of ["q3", "q2"]) {
      const familyId = `vidu-${version}`;
      for (const [service, speed] of [["pro", "standard"], ["turbo", "fast"]]) {
        const stem = `${familyId}-${service}`;
        register(`${stem}-text-to-video`, familyId, [null], { speed });
        register(`${stem}-image-to-video`, familyId, ["animate_image"], { speed });
        register(`${stem}-${version === "q3" ? "first-last-frames" : "start-end-video"}`,
          familyId, ["keyframes"], { speed });
      }
    }
    register("vidu-q4-image-to-video", "vidu-q4", ["animate_image"]);
    register("vidu-q4-reference-to-video", "vidu-q4", ["references"]);
    register("vidu-q2-reference", "vidu-q2", ["references"]);
    register("vidu-q1-reference", "vidu-q1", ["references"]);
  },
});

export const {
  getConfiguration: getViduConfiguration,
  resolveVariant: resolveViduVariant,
} = registry;

export const VIDU_MODEL_GROUP = Object.freeze({
  copyKey: "vidu",
  familyNames: VIDU_FAMILY_NAMES,
  configurations: registry.configurations,
  workflowVariants: registry.workflowVariants,
  resolveVariant: resolveViduVariant,
  getVariantOptions: registry.getVariantOptions,
});
