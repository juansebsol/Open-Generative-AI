import { createGroupedVideoRegistry } from "./groupedVideoRegistry.js";

const ALIBABA_FAMILY_NAMES = Object.freeze({
  "wan-3": "Wan 3.0",
  "wan-2.7": "Wan 2.7",
  "wan-2.6": "Wan 2.6",
  "wan-2.5": "Wan 2.5",
  "wan-2.2": "Wan 2.2",
  "wan-2.1": "Wan 2.1",
});

const registry = createGroupedVideoRegistry({
  facetOptions: {
    profile: [
      { value: "standard", label: "Standard" },
      { value: "prime", label: "Prime" },
    ],
    speed: [
      { value: "standard", label: "Standard" },
      { value: "fast", label: "Fast" },
    ],
  },
  facetLabels: { profile: "Model", speed: "Speed" },
  registerVariants(register) {
    for (const profile of ["standard", "prime"]) {
      const stem = `wan3.0${profile === "standard" ? "" : `-${profile}`}`;
      register(`${stem}-text-to-video`, "wan-3", [null], { profile });
      register(`${stem}-image-to-video`, "wan-3", ["animate_image", "keyframes"], { profile });
      register(`${stem}-reference-to-video`, "wan-3", ["references"], { profile });
      register(`${stem}-video-extend`, "wan-3", ["extend_uploaded_video"], { profile });
    }

    for (const version of ["2.7", "2.6", "2.5", "2.2", "2.1"]) {
      const stem = `wan${version}`;
      const familyId = `wan-${version}`;
      register(`${stem}-text-to-video`, familyId, [null]);
      register(`${stem}-image-to-video`, familyId,
        version === "2.7" || version === "2.2" ? ["animate_image", "keyframes"] : ["animate_image"]);
    }

    for (const mode of ["text", "image"]) {
      register(`wan2.5-${mode}-to-video-fast`, "wan-2.5", mode === "text" ? [null] : ["animate_image"], { speed: "fast" });
    }
    register("wan2.6-video-extend", "wan-2.6", ["extend_uploaded_video"]);
    register("wan2.5-video-extend", "wan-2.5", ["extend_uploaded_video"]);
    register("wan2.5-video-extend-fast", "wan-2.5", ["extend_uploaded_video"], { speed: "fast" });

    register("wan2.7-reference-to-video", "wan-2.7", ["references"]);
    register("wan2.7-video-edit", "wan-2.7", ["edit_video"]);
    register("wan2.7-video-extend", "wan-2.7", ["extend_uploaded_video"]);
    register("wan2.2-5b-fast-t2v", "wan-2.2", [null], { speed: "fast" });
    register("wan2.2-edit-video", "wan-2.2", ["edit_video"]);
    register("wan2.2-animate", "wan-2.2", ["motion_transfer"]);
    register("wan2.1-reference-video", "wan-2.1", ["references"]);
  },
});

export const {
  getConfiguration: getAlibabaConfiguration,
  resolveVariant: resolveAlibabaVariant,
} = registry;

export const ALIBABA_MODEL_GROUP = Object.freeze({
  copyKey: "alibaba",
  familyNames: ALIBABA_FAMILY_NAMES,
  configurations: registry.configurations,
  workflowVariants: registry.workflowVariants,
  resolveVariant: resolveAlibabaVariant,
  getVariantOptions: registry.getVariantOptions,
});
