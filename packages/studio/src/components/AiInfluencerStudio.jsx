"use client";

import { useEffect, useRef, useState } from "react";
import toast, { Toaster } from "react-hot-toast";
import {
  IconArrowsShuffle,
  IconBrush,
  IconDownload,
  IconMoodSmile,
  IconTrash,
  IconUserCheck,
  IconUserCircle,
  IconWalk,
} from "@tabler/icons-react";
import { generateImage } from "../generation.js";
import { getEndpointForModelId } from "../models.js";
import {
  PromptAction,
  PromptActionGroup,
  PromptChevronIcon,
  PromptComposer,
  PromptControls,
  PromptFooter,
  PromptPopover,
  PromptPopoverHeader,
  PromptRatioGrid,
  PromptRatioIcon,
  PromptSettingsGroup,
  PromptShortcutHint,
  PromptTextarea,
  promptControlClassName,
  promptModelButtonClassName,
  promptSettingClassName,
} from "./prompt/PromptComposer.jsx";
import PriceChip from "./prompt/PriceChip.jsx";
import { influencerPrompt } from "../influencerPrompt.js";
import { formatErrorMessage } from "../utils/formatError.js";
import MobileGenerationActions, {
  GenerationCopyButtons,
} from "./MobileGenerationActions.jsx";
import { LibraryActions, LibraryDetails, Lightbox, formatWhen } from "./library/LibraryKit.jsx";
import StudioEmptyState from "./StudioEmptyState.jsx";
import { Entrance } from "./motion/index.js";
import en from "../messages/en/aiInfluencerStudio.json";
import zh from "../messages/zh/aiInfluencerStudio.json";
import { resolveCopy } from "../i18nUtils";

// ── Default image generation model ──────────────────────────────────────────
const INFLUENCER_MODEL = "nano-banana-pro";

const TABS_CONFIG = {
  face: {
    label: "Face",
    subcategories: [
      {
        id: "character_type",
        label: "Character type",
        options: [
          { id: "human",             label: "Human", promptVal: "human features" },
          { id: "elf",               label: "Elf", promptVal: "elf with pointed ears" },
          { id: "alien",             label: "Alien", promptVal: "alien creature" },
          { id: "amphibian",         label: "Amphibian", promptVal: "amphibian humanoid" },
          { id: "reptile",           label: "Reptile", promptVal: "reptilian creature" },
          { id: "mantis",            label: "Mantis", promptVal: "mantis hybrid character" },
          { id: "bee",               label: "Bee", promptVal: "bee insect hybrid character" },
          { id: "octopus",           label: "Octopus", promptVal: "aquatic octopus hybrid" },
          { id: "crocodile",         label: "Crocodile", promptVal: "crocodile humanoid" },
          { id: "iguana",            label: "Iguana", promptVal: "iguana humanoid" },
          { id: "lizard",            label: "Lizard", promptVal: "lizard humanoid" },
          { id: "rhinoceros_beetle", label: "Beetle", promptVal: "rhinoceros beetle humanoid" },
          { id: "ant",               label: "Ant", promptVal: "ant hybrid character" },
        ],
      },
      {
        id: "gender",
        label: "Gender",
        options: [
          { id: "female",      label: "Female", promptVal: "female" },
          { id: "male",        label: "Male", promptVal: "male" },
          { id: "non_binary",  label: "Non-binary", promptVal: "non-binary character" },
          { id: "trans_man",   label: "Trans man", promptVal: "transgender man" },
          { id: "trans_woman", label: "Trans woman", promptVal: "transgender woman" },
        ],
      },
      {
        id: "ethnicity_origin_base",
        label: "Ethnicity / origin",
        options: [
          { id: "african",        label: "African", promptVal: "african heritage" },
          { id: "asian",          label: "Asian", promptVal: "east asian heritage" },
          { id: "european",       label: "European", promptVal: "european heritage" },
          { id: "indian",         label: "Indian", promptVal: "south asian indian heritage" },
          { id: "middle_eastern", label: "Middle Eastern", promptVal: "middle eastern heritage" },
          { id: "mixed",          label: "Mixed", promptVal: "multiracial mixed heritage" },
        ],
      },
      {
        id: "eye_color",
        label: "Eye color",
        options: [
          { id: "eye_blue",       label: "Blue", promptVal: "striking blue eyes" },
          { id: "eye_brown",      label: "Brown", promptVal: "warm brown eyes" },
          { id: "eye_green",      label: "Green", promptVal: "emerald green eyes" },
          { id: "eye_amber",      label: "Amber", promptVal: "amber eyes" },
          { id: "eye_grey",       label: "Grey", promptVal: "grey eyes" },
          { id: "eye_red",        label: "Red", promptVal: "red eyes" },
          { id: "eye_purple",     label: "Purple", promptVal: "violet purple eyes" },
          { id: "eye_black",      label: "Black", promptVal: "black eyes" },
          { id: "eye_deep_brown", label: "Deep brown", promptVal: "deep dark brown eyes" },
          { id: "eye_white",      label: "White", promptVal: "white eyes" },
          { id: "eye_black_void", label: "Solid black", promptVal: "solid black void eyes" },
          { id: "eye_white_void", label: "Blind / empty", promptVal: "blind empty white eyes" },
        ],
      },
      {
        id: "eyes_type",
        label: "Eye type",
        options: [
          { id: "eyes_human",      label: "Human", promptVal: "normal human eyes" },
          { id: "eyes_reptile",    label: "Reptile", promptVal: "reptile slit-pupil eyes" },
          { id: "eyes_mechanical", label: "Mechanical", promptVal: "mechanical cyborg eyes" },
        ],
      },
      {
        id: "eyes_details",
        label: "Eye features",
        options: [
          { id: "eyes_different_colors", label: "Heterochromia", promptVal: "heterochromia different eye colors" },
          { id: "eyes_blind",            label: "Blind eye", promptVal: "one cloudy blind eye" },
          { id: "eyes_scarred",          label: "Scarred eye", promptVal: "scar running across one eye" },
          { id: "eyes_glowing",          label: "Glowing eye", promptVal: "glowing magical eyes" },
        ],
      },
      {
        id: "mouth",
        label: "Mouth & teeth",
        options: [
          { id: "mouth_small",           label: "Small mouth", promptVal: "small delicate mouth" },
          { id: "mouth_large",           label: "Large mouth", promptVal: "wide expressive mouth" },
          { id: "mouth_no_teeth",        label: "No teeth", promptVal: "no visible teeth" },
          { id: "mouth_different_teeth", label: "Unique teeth", promptVal: "unusual tooth structure" },
          { id: "mouth_sharp_teeth",     label: "Sharp teeth", promptVal: "sharp predatory fangs" },
          { id: "mouth_forked_tongue",   label: "Forked tongue", promptVal: "reptilian forked tongue" },
          { id: "mouth_two_tongues",     label: "Two tongues", promptVal: "two separate tongues" },
        ],
      },
      {
        id: "ears",
        label: "Ears",
        options: [
          { id: "ears_human", label: "Human", promptVal: "normal human ears" },
          { id: "ears_elf",   label: "Elf ears", promptVal: "pointed elf ears" },
          { id: "ears_no",    label: "No ears", promptVal: "no visible ears" },
          { id: "ears_wings", label: "Wing ears", promptVal: "wing ears" },
        ],
      },
      {
        id: "horns",
        label: "Horns",
        options: [
          { id: "small_horns", label: "Small horns", promptVal: "small horns on forehead" },
          { id: "big_horns",   label: "Big horns", promptVal: "large curved horns" },
          { id: "antlers",     label: "Antlers", promptVal: "deer antlers on head" },
        ],
      },
      {
        id: "skin_conditions",
        label: "Skin conditions",
        options: [
          { id: "condition_vitiligo",     label: "Vitiligo", promptVal: "vitiligo skin condition" },
          { id: "condition_pigmentation", label: "Pigmentation", promptVal: "hyperpigmentation" },
          { id: "condition_freckles",     label: "Freckles", promptVal: "freckled skin" },
          { id: "condition_birthmarks",   label: "Birthmarks", promptVal: "visible birthmarks" },
          { id: "condition_scars",        label: "Scars", promptVal: "scarred skin" },
          { id: "condition_burns",        label: "Burns", promptVal: "burn marks on skin" },
          { id: "condition_albinism",     label: "Albinism", promptVal: "albinism pale white skin" },
          { id: "condition_cracked",      label: "Cracked skin", promptVal: "cracked dry skin texture" },
          { id: "condition_wrinkled",     label: "Wrinkled", promptVal: "wrinkled aged skin" },
        ],
      },
    ],
  },
  body: {
    label: "Body",
    subcategories: [
      {
        id: "face_skin_material",
        label: "Face skin material",
        options: [
          { id: "face_skin_human",     label: "Human skin", promptVal: "smooth human skin" },
          { id: "face_skin_scales",    label: "Scales", promptVal: "shimmering scales" },
          { id: "face_skin_fur",       label: "Fur", promptVal: "soft fur covered face" },
          { id: "face_skin_amphibian", label: "Amphibian", promptVal: "smooth moist amphibian skin" },
          { id: "face_skin_fish",      label: "Fish skin", promptVal: "iridescent fish scale skin" },
          { id: "face_skin_metallic",  label: "Metallic", promptVal: "polished metallic skin" },
        ],
      },
      {
        id: "face_surface_pattern",
        label: "Skin pattern",
        options: [
          { id: "face_pattern_solid",    label: "Solid", promptVal: "solid color skin" },
          { id: "face_pattern_stripes",  label: "Stripes", promptVal: "exotic striped skin pattern" },
          { id: "face_pattern_spots",    label: "Spots", promptVal: "dappled spotted skin" },
          { id: "face_pattern_chess",    label: "Chess", promptVal: "checkerboard skin pattern" },
          { id: "face_pattern_veins",    label: "Veins", promptVal: "translucent skin with neon veins" },
          { id: "face_pattern_gradient", label: "Gradient", promptVal: "gradient skin coloring" },
          { id: "face_pattern_giraffe",  label: "Giraffe", promptVal: "giraffe print skin markings" },
        ],
      },
      {
        id: "body_type",
        label: "Body type",
        options: [
          { id: "body_slim",     label: "Slim", promptVal: "slim slender physique" },
          { id: "body_lean",     label: "Lean", promptVal: "lean toned physique" },
          { id: "body_athletic", label: "Athletic", promptVal: "fit athletic body" },
          { id: "body_muscular", label: "Muscular", promptVal: "strong muscular build" },
          { id: "body_curvy",    label: "Curvy", promptVal: "curvy body type" },
          { id: "body_heavy",    label: "Heavy", promptVal: "heavy set build" },
          { id: "body_skinny",   label: "Skinny", promptVal: "very skinny thin build" },
        ],
      },
      {
        id: "left_arm",
        label: "Left arm",
        options: [
          { id: "left_arm_normal",     label: "Normal", promptVal: "normal left arm" },
          { id: "left_arm_cute",       label: "Cute prosthetic", promptVal: "stylish pink prosthetic left arm with cute stickers" },
          { id: "left_arm_robotic",    label: "Robotic", promptVal: "robotic left arm" },
          { id: "left_arm_prosthetic", label: "Prosthetic", promptVal: "prosthetic left arm" },
          { id: "left_arm_mechanical", label: "Mechanical", promptVal: "mechanical left arm" },
          { id: "left_arm_none",       label: "None", promptVal: "no left arm" },
        ],
      },
      {
        id: "right_arm",
        label: "Right arm",
        options: [
          { id: "right_arm_normal",     label: "Normal", promptVal: "normal right arm" },
          { id: "right_arm_cute",       label: "Cute prosthetic", promptVal: "stylish pink prosthetic right arm with cute stickers" },
          { id: "right_arm_robotic",    label: "Robotic", promptVal: "robotic right arm" },
          { id: "right_arm_prosthetic", label: "Prosthetic", promptVal: "prosthetic right arm" },
          { id: "right_arm_mechanical", label: "Mechanical", promptVal: "mechanical right arm" },
          { id: "right_arm_none",       label: "None", promptVal: "no right arm" },
        ],
      },
      {
        id: "left_leg",
        label: "Left leg",
        options: [
          { id: "left_leg_normal",     label: "Normal", promptVal: "normal left leg" },
          { id: "left_leg_cute",       label: "Cute prosthetic", promptVal: "stylish pink prosthetic left leg with cute stickers" },
          { id: "left_leg_robotic",    label: "Robotic", promptVal: "robotic left leg" },
          { id: "left_leg_prosthetic", label: "Prosthetic", promptVal: "prosthetic left leg" },
          { id: "left_leg_mechanical", label: "Mechanical", promptVal: "mechanical left leg" },
          { id: "left_leg_none",       label: "None", promptVal: "no left leg" },
        ],
      },
      {
        id: "right_leg",
        label: "Right leg",
        options: [
          { id: "right_leg_normal",     label: "Normal", promptVal: "normal right leg" },
          { id: "right_leg_cute",       label: "Cute prosthetic", promptVal: "stylish pink prosthetic right leg with cute stickers" },
          { id: "right_leg_robotic",    label: "Robotic", promptVal: "robotic right leg" },
          { id: "right_leg_prosthetic", label: "Prosthetic", promptVal: "prosthetic right leg" },
          { id: "right_leg_mechanical", label: "Mechanical", promptVal: "mechanical right leg" },
          { id: "right_leg_none",       label: "None", promptVal: "no right leg" },
        ],
      },
    ],
  },
  style: {
    label: "Style",
    subcategories: [
      {
        id: "hair",
        label: "Hair / head growth",
        options: [
          { id: "hair_bald",      label: "Bald", promptVal: "bald head" },
          { id: "hair_short",     label: "Short hair", promptVal: "short hair" },
          { id: "hair_long",      label: "Long hair", promptVal: "long flowing hair" },
          { id: "hair_afro",      label: "Afro", promptVal: "afro hairstyle" },
          { id: "hair_punk",      label: "Punk", promptVal: "punk mohawk hairstyle" },
          { id: "hair_fur",       label: "Fur / mane", promptVal: "fur mane on head" },
          { id: "hair_tentacles", label: "Tentacles", promptVal: "tentacles as hair" },
          { id: "hair_spines",    label: "Spines", promptVal: "spines as hair" },
        ],
      },
      {
        id: "accessories",
        label: "Accessories & markings",
        options: [
          { id: "accessory_tattoos",       label: "Tattoos", promptVal: "covered in tattoos" },
          { id: "accessory_piercing",      label: "Piercings", promptVal: "multiple piercings" },
          { id: "accessory_scarification", label: "Scarification", promptVal: "ritual scarification marks" },
          { id: "accessory_symbols",       label: "Symbols / markings", promptVal: "symbolic tribal markings" },
          { id: "accessory_cyber",         label: "Cyber markings", promptVal: "cyberpunk circuit markings" },
        ],
      },
      {
        id: "rendering_style",
        label: "Rendering style",
        options: [
          { id: "style_hyper_realistic", label: "Hyper-realistic", promptVal: "realistic photo" },
          { id: "style_anime",           label: "Anime", promptVal: "anime art style" },
          { id: "style_cartoon",         label: "Cartoon", promptVal: "cartoon illustration style" },
          { id: "style_2d",              label: "2D illustration", promptVal: "2D flat illustration style" },
        ],
      },
    ],
  },
};

// ─── Traits, presets and the bar's pieces ───────────────────────────────────

const ASPECT_RATIOS = ["3:4", "1:1", "9:16", "16:9"];
const PERSIST_KEY = "oga_ai_influencer_studio";
const HISTORY_LIMIT = 50;

const CATEGORY_ICONS = { face: IconMoodSmile, body: IconWalk, style: IconBrush };

const SUBCATEGORIES = Object.values(TABS_CONFIG).flatMap((tab) => tab.subcategories);

// Eye colors show as a dot in front of their name.
const EYE_DOTS = {
  eye_blue: "#3b82f6",
  eye_brown: "#8b5a2b",
  eye_green: "#22a35a",
  eye_amber: "#d99a2b",
  eye_grey: "#9ca3af",
  eye_red: "#dc2626",
  eye_purple: "#8b5cf6",
  eye_black: "#111111",
  eye_deep_brown: "#4a2c17",
  eye_white: "#f5f5f5",
  eye_black_void: "#000000",
  eye_white_void: "#e5e7eb",
};

// Starting points for an empty studio: a few traits picked at once.
const PRESETS = [
  {
    id: "elf",
    picks: { character_type: "elf", gender: "female", ears: "ears_elf", hair: "hair_long", rendering_style: "style_anime" },
  },
  {
    id: "cyborg",
    picks: { character_type: "human", eyes_type: "eyes_mechanical", right_arm: "right_arm_robotic", accessories: "accessory_cyber", rendering_style: "style_hyper_realistic" },
  },
  {
    id: "reptile",
    picks: { character_type: "reptile", face_skin_material: "face_skin_scales", eyes_type: "eyes_reptile", mouth: "mouth_forked_tongue", rendering_style: "style_cartoon" },
  },
];

// Values that only make sense with their trait's name ("Eye color: Amber").
const NAMED_TRAITS = new Set([
  "eye_color",
  "eyes_type",
  "ears",
  "face_skin_material",
  "face_surface_pattern",
  "body_type",
  "left_arm",
  "right_arm",
  "left_leg",
  "right_leg",
]);

// The empty studio's picture: one character three ways (the clay sculpt
// being built, the finished face, a shot from her feed) fanned like cards.
// Each card bobs on its own beat and the fan spreads a little on hover.
const FAN_CARDS = [
  {
    src: "/assets/influencer/sculpt.jpg",
    place: "left-[3%] top-[17%] z-10 w-[34%] -rotate-[7deg] group-hover:-translate-x-[7%] group-hover:-rotate-[10deg]",
    delay: "0s",
  },
  {
    src: "/assets/influencer/portrait.jpg",
    place: "left-1/2 top-[4%] z-20 w-[43%] -translate-x-1/2 group-hover:-translate-y-[2%]",
    delay: "-2.4s",
  },
  {
    src: "/assets/influencer/feed.jpg",
    place: "right-[3%] top-[21%] z-10 w-[32%] rotate-[6deg] group-hover:translate-x-[7%] group-hover:rotate-[9deg]",
    delay: "-4.8s",
  },
];

function CharacterFan() {
  return (
    <div aria-hidden="true" className="flex h-full min-h-0 items-center justify-center">
      <div className="group relative aspect-[16/15] max-h-full w-full max-w-[660px]">
        <span className="absolute inset-x-[15%] bottom-[6%] h-[40%] rounded-full bg-[#22d3ee]/[0.08] blur-[80px]" />
        {FAN_CARDS.map((card) => (
          <div key={card.src} className={`absolute transition-transform duration-500 ease-out ${card.place}`}>
            <div
              className="oga-float aspect-[9/16] overflow-hidden rounded-[24px] border border-white/[0.14] bg-[#111114] shadow-[0_30px_80px_rgba(0,0,0,0.7)]"
              style={{ animationDelay: card.delay }}
            >
              <img src={card.src} alt="" className="h-full w-full object-cover" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// The picked traits in builder order: [{ sub, opt }].
function pickedTraits(selected) {
  return SUBCATEGORIES.flatMap((sub) => {
    const opt = sub.options.find((option) => option.id === selected[sub.id]);
    return opt ? [{ sub, opt }] : [];
  });
}

// Only picks that still name a trait survive a reload.
function validPicks(picks) {
  const next = {};
  SUBCATEGORIES.forEach((sub) => {
    if (sub.options.some((option) => option.id === picks?.[sub.id])) next[sub.id] = picks[sub.id];
  });
  return next;
}

// ─── Main Component ─────────────────────────────────────────────────────────
export default function AiInfluencerStudio({
  onGenerate,
  onGenerationStart,
  onGenerationEnd,
  onGenerationComplete,
  onGenerationError,
  isGenerating: externalIsGenerating,
  locale = "en",
}) {
  const copy = resolveCopy(en, zh, locale);

  // Nothing is picked until the visitor picks: traits are the character.
  const [selectedOptions, setSelectedOptions] = useState({});
  const [traitTab, setTraitTab] = useState("face");
  const [aspectRatio, setAspectRatio] = useState("3:4");
  const [customPrompt, setCustomPrompt] = useState("");
  const [isGeneratingInternal, setIsGeneratingInternal] = useState(false);
  const [history, setHistory] = useState([]);
  const [fullscreen, setFullscreen] = useState(null); // { entry, idx }
  const [openDropdown, setOpenDropdown] = useState(null); // 'traits' | 'ratio' | null
  const [hydrated, setHydrated] = useState(false);
  const textareaRef = useRef(null);

  const isGenerating = externalIsGenerating || isGeneratingInternal;
  const picked = pickedTraits(selectedOptions);
  const traitLabels = picked.map(({ sub, opt }) =>
    NAMED_TRAITS.has(sub.id) ? `${copy.subcategories[sub.id] || sub.label}: ${opt.label}` : opt.label,
  );
  const traitsOpen = openDropdown === "traits";

  // ── Persistence ───────────────────────────────────────────────────────────
  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(PERSIST_KEY) || "null");
      if (stored) {
        if (Array.isArray(stored.history)) setHistory(stored.history.filter((entry) => entry?.url));
        if (stored.selectedOptions) setSelectedOptions(validPicks(stored.selectedOptions));
        if (ASPECT_RATIOS.includes(stored.aspectRatio)) setAspectRatio(stored.aspectRatio);
      }
    } catch (err) {
      console.warn("Failed to load AiInfluencerStudio persistence:", err);
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return undefined;
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(PERSIST_KEY, JSON.stringify({ history, selectedOptions, aspectRatio }));
      } catch (err) {
        console.warn("Failed to save AiInfluencerStudio persistence:", err);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [hydrated, history, selectedOptions, aspectRatio]);

  // A click outside a popover (popovers stop their own clicks) or Escape closes it.
  useEffect(() => {
    if (!openDropdown) return undefined;
    const close = () => setOpenDropdown(null);
    const handleKeyDown = (event) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("click", close);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("click", close);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [openDropdown]);

  const toggleDropdown = (name) => (event) => {
    event.stopPropagation();
    setOpenDropdown((open) => (open === name ? null : name));
  };

  // ── Traits ────────────────────────────────────────────────────────────────
  // Picking the picked trait again clears it.
  const toggleTrait = (subcatId, optId) =>
    setSelectedOptions((prev) => {
      const next = { ...prev };
      if (next[subcatId] === optId) delete next[subcatId];
      else next[subcatId] = optId;
      return next;
    });

  const handleShuffle = () => {
    const next = {};
    SUBCATEGORIES.forEach((sub) => {
      if (sub.options?.length > 0)
        next[sub.id] = sub.options[Math.floor(Math.random() * sub.options.length)].id;
    });
    setSelectedOptions(next);
  };

  // A starter picks its traits and shows them in the sheet.
  const applyPreset = (presetId) => {
    const preset = PRESETS.find((item) => item.id === presetId);
    if (!preset) return;
    setSelectedOptions({ ...preset.picks });
    setTraitTab("face");
    setTimeout(() => setOpenDropdown("traits"), 0);
  };

  const buildPrompt = () =>
    influencerPrompt({
      traits: picked.map(({ sub, opt }) => ({ sub: sub.id, opt: opt.id, value: opt.promptVal })),
      custom: customPrompt,
      aspect: aspectRatio,
    });

  // ── Generate ──────────────────────────────────────────────────────────────
  // With no traits picked, Generate opens the traits instead.
  const handleGenerate = async () => {
    if (isGenerating) return;
    if (picked.length === 0) {
      setOpenDropdown("traits");
      return;
    }
    onGenerationStart?.();
    setIsGeneratingInternal(true);

    const prompt = buildPrompt();
    const picks = { ...selectedOptions };
    try {
      let res;
      if (onGenerate) {
        res = await onGenerate({ prompt, aspectRatio, selections: picks });
      } else {
        res = await generateImage({
          model: INFLUENCER_MODEL,
          prompt,
          aspect_ratio: aspectRatio,
        });
      }
      if (res?.url) {
        const entry = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          url: res.url,
          prompt,
          traits: traitLabels,
          picks,
          aspect_ratio: aspectRatio,
          timestamp: new Date().toISOString(),
        };
        setHistory((prev) => [entry, ...prev].slice(0, HISTORY_LIMIT));
        onGenerationComplete?.({
          url: res.url,
          model: INFLUENCER_MODEL,
          prompt,
          type: "image",
        });
      }
    } catch (err) {
      const message = formatErrorMessage(err, copy.errors.generationFailed);
      if (onGenerationError) onGenerationError(message);
      else toast.error(message);
    } finally {
      setIsGeneratingInternal(false);
      onGenerationEnd?.();
    }
  };

  const submitOnEnter = (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      handleGenerate();
    }
  };

  // ── Library ───────────────────────────────────────────────────────────────
  const downloadImg = async (url) => {
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `ai-influencer-${Date.now()}.webp`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch {
      window.open(url, "_blank");
    }
  };

  const deleteEntry = (entry) => {
    if (!confirm(copy.gallery.deleteConfirm)) return;
    setHistory((prev) => prev.filter((item) => item !== entry));
    setFullscreen((current) => (current?.entry === entry ? null : current));
  };

  const reuseTraits = (entry) => {
    setSelectedOptions(validPicks(entry.picks));
    setFullscreen(null);
    toast.success(copy.gallery.traitsReused);
  };

  // The same tools on a card's hover column ("sm") and the viewer's rail ("lg").
  const characterActions = (entry, size) => {
    const iconSize = size === "lg" ? 18 : 15;
    return [
      { key: "copy", node: <GenerationCopyButtons prompt={entry.prompt} imageUrl={entry.url} onCopyError={onGenerationError} size={size} /> },
      entry.picks && { key: "reuse", label: copy.gallery.reuseTraits, icon: <IconUserCheck size={iconSize} stroke={2} aria-hidden="true" />, onSelect: () => reuseTraits(entry) },
      { key: "download", label: copy.gallery.download, icon: <IconDownload size={iconSize} stroke={2} aria-hidden="true" />, onSelect: () => downloadImg(entry.url) },
      { key: "delete", label: copy.gallery.delete, danger: true, icon: <IconTrash size={iconSize} stroke={2} aria-hidden="true" />, onSelect: () => deleteEntry(entry) },
    ];
  };

  const entryFacts = (entry) => [{ key: "ar", value: entry.aspect_ratio, title: copy.bar.aspectRatio }];

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="relative flex h-full w-full flex-col items-center justify-center overflow-hidden bg-app-bg p-4 text-white md:p-6">

      {/* ── GALLERY ── */}
      <div className="custom-scrollbar mx-auto w-full max-w-7xl flex-1 overflow-y-auto px-2 pb-44 lg:pb-36">
        {history.length > 0 || isGenerating ? (
          <div className="oga-enter-fade grid w-full grid-cols-2 gap-4 pt-4 md:grid-cols-3 md:gap-6 lg:grid-cols-4">
            {isGenerating && (
              <div className="flex flex-col overflow-hidden rounded-lg border border-primary/30 bg-[#0a0a0a]" data-influencer-pending>
                <div className="flex aspect-[3/4] w-full flex-col items-center justify-center gap-3 bg-[#111114]">
                  <span aria-hidden="true" className="h-9 w-9 animate-spin rounded-full border-[3px] border-[#22d3ee]/20 border-t-[#22d3ee]" />
                  <span className="text-[13px] font-medium text-white/75">{copy.preview.generating}</span>
                </div>
                <p className="flex-1 border-t border-white/5 bg-black/80 p-3 text-xs leading-relaxed text-white/70">
                  {traitLabels.join(" · ")}
                </p>
              </div>
            )}
            {history.map((entry, idx) => (
              <Entrance
                once
                variant="card"
                index={idx}
                key={entry.id || entry.url}
                className="group relative flex cursor-pointer flex-col overflow-hidden rounded-lg border border-white/10 bg-[#0a0a0a] shadow-xl transition-all duration-300 hover:border-primary/50"
                onClick={() => setFullscreen({ entry, idx })}
              >
                <img
                  src={entry.url}
                  alt={entry.traits?.join(", ") || copy.preview.altGenerated}
                  className="aspect-[3/4] w-full bg-black/40 object-cover transition-opacity hover:opacity-80"
                />
                <LibraryActions actions={characterActions(entry, "sm")} />
                <MobileGenerationActions
                  prompt={entry.prompt}
                  imageUrl={entry.url}
                  onCopyError={onGenerationError}
                  actions={[
                    entry.picks && { kind: "reuse", label: copy.gallery.reuseTraits, onSelect: () => reuseTraits(entry) },
                    { kind: "download", label: copy.gallery.download, onSelect: () => downloadImg(entry.url) },
                    { kind: "delete", label: copy.gallery.delete, danger: true, onSelect: () => deleteEntry(entry) },
                  ].filter(Boolean)}
                />
                <LibraryDetails
                  prompt={entry.traits?.join(" · ")}
                  fallback={copy.gallery.noTraits}
                  model={copy.gallery.model}
                  facts={entryFacts(entry)}
                  trailing={{ value: formatWhen(entry.timestamp, locale), title: copy.gallery.created }}
                />
              </Entrance>
            ))}
          </div>
        ) : (
          <div className="h-full w-full">
            <StudioEmptyState
              heading={copy.empty.heading}
              accent={copy.empty.accent}
              subtitle={copy.empty.subtitle}
              starters={PRESETS.map((preset) => ({ label: copy.presets[preset.id], prompt: preset.id }))}
              onStarter={applyPreset}
              showcase={null}
              visual={<CharacterFan />}
            />
          </div>
        )}
      </div>

      {/* ── BOTTOM PROMPT BAR ── */}
      <PromptComposer>
          <PromptTextarea
            ref={textareaRef}
            value={customPrompt}
            onChange={(event) => setCustomPrompt(event.target.value)}
            onKeyDown={submitOnEnter}
            placeholder={copy.customPrompt.placeholder}
          />

          <PromptFooter>
            <PromptControls>
              <div className="relative min-w-0">
                <button
                  type="button"
                  aria-haspopup="dialog"
                  aria-expanded={traitsOpen}
                  onClick={toggleDropdown("traits")}
                  className={promptModelButtonClassName({
                    active: traitsOpen,
                    className:
                      picked.length === 0 && !traitsOpen
                        ? "oga-pulse-ring !border-[#22d3ee]/60 !bg-[#22d3ee]/[0.06] hover:!bg-[#22d3ee]/[0.12]"
                        : "",
                  })}
                  data-influencer-traits
                >
                  <IconUserCircle size={16} stroke={1.75} className="shrink-0 text-[#67e8f9]" aria-hidden="true" />
                  {picked.length === 0 ? copy.bar.pickTraits : copy.bar.traits}
                  {picked.length > 0 && (
                    <span className="flex h-[18px] items-center rounded-md bg-[#22d3ee]/[0.14] px-1.5 font-mono text-[11px] text-[#a5f3fc]">
                      {picked.length}
                    </span>
                  )}
                  <PromptChevronIcon className={traitsOpen ? "rotate-180" : ""} />
                </button>

                {traitsOpen && (
                  <PromptPopover
                    role="dialog"
                    aria-label={copy.traits.title}
                    onClick={(event) => event.stopPropagation()}
                    className="flex h-[min(520px,64vh)] w-[680px] max-w-[calc(100vw-2rem)] !max-h-[70vh] flex-col !overflow-hidden !p-0"
                    fitViewport
                    solid
                    data-influencer-traits-sheet
                  >
                    <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-white/[0.06] pl-4 pr-2">
                      <div className="flex min-w-0 items-baseline gap-2.5">
                        <span className="text-[13.5px] font-semibold text-white">{copy.traits.title}</span>
                        <span className="hidden truncate text-[12px] text-white/45 sm:inline">{copy.traits.hint}</span>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          onClick={handleShuffle}
                          className="flex h-[30px] items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] font-medium text-white/70 transition-colors hover:bg-white/[0.06] hover:text-white focus:outline-none focus-visible:ring-1 focus-visible:ring-[#22d3ee]/50"
                          data-influencer-shuffle-all
                        >
                          <IconArrowsShuffle size={15} stroke={1.75} aria-hidden="true" />
                          {copy.traits.shuffleAll}
                        </button>
                        <button
                          type="button"
                          onClick={() => setSelectedOptions({})}
                          disabled={picked.length === 0}
                          className="h-[30px] rounded-lg px-2.5 text-[12.5px] font-medium text-white/55 transition-colors hover:bg-white/[0.06] hover:text-white focus:outline-none focus-visible:ring-1 focus-visible:ring-[#22d3ee]/50 disabled:opacity-40 disabled:hover:bg-transparent"
                          data-influencer-reset
                        >
                          {copy.builder.reset}
                        </button>
                      </div>
                    </div>

                    <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
                      <div
                        role="tablist"
                        aria-label={copy.traits.groups}
                        className="flex shrink-0 gap-1 border-b border-white/[0.06] p-2 sm:w-[168px] sm:flex-col sm:gap-0.5 sm:border-b-0 sm:border-r"
                      >
                        {Object.keys(TABS_CONFIG).map((key) => {
                          const Icon = CATEGORY_ICONS[key];
                          const subs = TABS_CONFIG[key].subcategories;
                          const count = subs.filter((sub) => selectedOptions[sub.id]).length;
                          const selected = traitTab === key;
                          return (
                            <button
                              key={key}
                              type="button"
                              role="tab"
                              aria-selected={selected}
                              onClick={() => setTraitTab(key)}
                              className={`flex h-[38px] min-w-0 flex-1 items-center gap-2 rounded-[9px] px-2.5 text-[13px] font-medium transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-[#22d3ee]/50 sm:flex-none ${
                                selected
                                  ? "bg-white/[0.08] text-white"
                                  : "text-white/[0.65] hover:bg-white/[0.04] hover:text-white"
                              }`}
                              data-influencer-trait-tab={key}
                            >
                              <Icon size={16} stroke={1.75} aria-hidden="true" className={`hidden shrink-0 sm:block ${selected ? "text-[#67e8f9]" : ""}`} />
                              <span className="flex-1 truncate text-left">{copy.categoryTabs[key] || TABS_CONFIG[key].label}</span>
                              <span className="font-mono text-[11px] text-white/45">
                                {count}/{subs.length}
                              </span>
                            </button>
                          );
                        })}
                      </div>

                      <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-4">
                        <div className="flex flex-col gap-[18px]">
                          {TABS_CONFIG[traitTab].subcategories.map((sub) => {
                            const current = sub.options.find((option) => option.id === selectedOptions[sub.id]);
                            const name = copy.subcategories[sub.id] || sub.label;
                            return (
                              <div key={sub.id} role="group" aria-label={name} className="flex flex-col gap-2" data-influencer-group={sub.id}>
                                <div className="flex items-baseline justify-between gap-3">
                                  <span className="text-[12px] text-white/55">{name}</span>
                                  <span className={`truncate text-[11.5px] ${current ? "text-[#67e8f9]" : "text-white/30"}`}>
                                    {current ? current.label : copy.traits.any}
                                  </span>
                                </div>
                                <div className="flex flex-wrap gap-1.5">
                                  {sub.options.map((opt) => {
                                    const on = selectedOptions[sub.id] === opt.id;
                                    return (
                                      <button
                                        key={opt.id}
                                        type="button"
                                        aria-pressed={on}
                                        onClick={() => toggleTrait(sub.id, opt.id)}
                                        className={`flex h-[30px] items-center gap-1.5 rounded-lg border px-2.5 text-[12.5px] font-medium transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-[#22d3ee]/50 ${
                                          on
                                            ? "border-[#22d3ee]/50 bg-[#22d3ee]/10 text-[#a5f3fc]"
                                            : "border-white/[0.08] bg-white/[0.03] text-white/75 hover:border-white/[0.16] hover:bg-white/[0.06] hover:text-white"
                                        }`}
                                      >
                                        {EYE_DOTS[opt.id] && (
                                          <span
                                            aria-hidden="true"
                                            className="h-[9px] w-[9px] shrink-0 rounded-full shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25)]"
                                            style={{ backgroundColor: EYE_DOTS[opt.id] }}
                                          />
                                        )}
                                        {opt.label}
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </PromptPopover>
                )}
              </div>

              <PromptSettingsGroup label={copy.bar.outputSettings}>
                <div key="ratio" className="relative flex">
                  <button
                    type="button"
                    aria-haspopup="dialog"
                    aria-expanded={openDropdown === "ratio"}
                    aria-label={`${copy.bar.aspectRatio}: ${aspectRatio}`}
                    onClick={toggleDropdown("ratio")}
                    className={promptSettingClassName({ active: openDropdown === "ratio" })}
                    data-influencer-setting="ratio"
                  >
                    <PromptRatioIcon ratio={aspectRatio} active={openDropdown === "ratio"} />
                    {aspectRatio}
                  </button>
                  {openDropdown === "ratio" && (
                    <PromptPopover
                      role="dialog"
                      aria-label={copy.bar.aspectRatio}
                      onClick={(event) => event.stopPropagation()}
                      className="w-[300px] max-w-[calc(100vw-2rem)]"
                      fitViewport
                      data-influencer-ratio-picker
                    >
                      <PromptPopoverHeader>{copy.bar.aspectRatio}</PromptPopoverHeader>
                      <PromptRatioGrid
                        options={ASPECT_RATIOS}
                        selected={aspectRatio}
                        columns={4}
                        onSelect={(value) => {
                          setAspectRatio(value);
                          setOpenDropdown(null);
                        }}
                      />
                    </PromptPopover>
                  )}
                </div>
              </PromptSettingsGroup>

              <button
                type="button"
                onClick={handleShuffle}
                aria-label={copy.toolbar.shuffleAll}
                title={copy.toolbar.shuffleAll}
                className={promptControlClassName({ iconOnly: true })}
                data-influencer-shuffle
              >
                <IconArrowsShuffle size={16} stroke={1.75} className="opacity-70 transition-opacity group-hover:opacity-100" aria-hidden="true" />
              </button>

              <span className="hidden min-w-0 max-w-[280px] truncate pl-1 text-[12.5px] text-white/45 lg:block" title={traitLabels.join(" · ")}>
                {picked.length === 0
                  ? copy.bar.noTraits
                  : traitLabels.length > 4
                    ? `${traitLabels.slice(0, 4).join(" · ")} · ${copy.bar.more.replace("{count}", traitLabels.length - 4)}`
                    : traitLabels.join(" · ")}
              </span>
            </PromptControls>

            <PromptActionGroup>
              <PromptShortcutHint />
              <PromptAction
                onClick={(event) => {
                  event.stopPropagation();
                  handleGenerate();
                }}
                disabled={isGenerating}
                addon={
                  <PriceChip
                    variant="inset"
                    locale={locale}
                    endpoint={getEndpointForModelId(INFLUENCER_MODEL)}
                    payload={{ aspect_ratio: aspectRatio }}
                  />
                }
                data-influencer-generate
              >
                {isGenerating ? (
                  <>
                    <span className="animate-spin inline-block">◌</span>
                    {copy.toolbar.generating}
                  </>
                ) : (
                  copy.toolbar.generate
                )}
              </PromptAction>
            </PromptActionGroup>
          </PromptFooter>
      </PromptComposer>

      {/* ── FULL-SCREEN VIEWER ── */}
      {fullscreen && (
        <Lightbox
          onClose={() => setFullscreen(null)}
          closeLabel={copy.gallery.close}
          tools={characterActions(fullscreen.entry, "lg")}
          caption={
            <>
              {fullscreen.entry.traits?.length > 0 && (
                <span className="line-clamp-2 text-white/80">{fullscreen.entry.traits.join(" · ")}</span>
              )}
              <span className="mt-1 block text-white/45">
                {[copy.gallery.model, fullscreen.entry.aspect_ratio, formatWhen(fullscreen.entry.timestamp, locale)].filter(Boolean).join(" · ")}
              </span>
            </>
          }
        >
          <img
            src={fullscreen.entry.url}
            alt={fullscreen.entry.traits?.join(", ") || copy.preview.altGenerated}
            className="max-h-[86vh] max-w-[calc(100vw-9rem)] rounded-2xl object-contain shadow-2xl md:max-w-[calc(100vw-12rem)]"
          />
        </Lightbox>
      )}

      <Toaster position="top-right" containerStyle={{ zIndex: 99999 }} toastOptions={{ duration: 5000, style: { background: '#18181b', color: '#ffffff', border: '1px solid rgba(255,255,255,0.15)', fontSize: '13px', borderRadius: '12px', boxShadow: '0 10px 30px rgba(0,0,0,0.6)', maxWidth: '440px', wordBreak: 'break-word', whiteSpace: 'pre-wrap', padding: '12px 16px' } }} />
    </div>
  );
}
