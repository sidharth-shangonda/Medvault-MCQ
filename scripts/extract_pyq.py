#!/usr/bin/env python3
"""Extract Marrow ED8 PYQs into a structured offline question bank."""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import re
import sys
import warnings
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from pypdf import PdfReader


SUBJECT_ALIASES = {
    "community medicine": "Community Medicine",
    "obstetrics & gynecology": "Obstetrics and Gynecology",
    "obstetrics and gynecology": "Obstetrics and Gynecology",
}

SUBJECTS = [
    "Obstetrics and Gynecology",
    "Community Medicine",
    "Forensic Medicine",
    "Biochemistry",
    "Pharmacology",
    "Microbiology",
    "Ophthalmology",
    "Orthopedics",
    "Physiology",
    "Paediatrics",
    "Dermatology",
    "Psychiatry",
    "Radiology",
    "Anesthesia",
    "Pathology",
    "Anatomy",
    "Medicine",
    "Surgery",
    "ENT",
]

HEADING_RE = re.compile(
    r"^("
    + "|".join(re.escape(subject) for subject in sorted(SUBJECTS, key=len, reverse=True))
    + r")\s+(AIIMS|NEET|INI-CET)\s+(\d{4})(.*)$",
    re.IGNORECASE,
)
QUESTION_RE = re.compile(r"^Question\s+(\d+)\s*:?\s*(.*)$", re.IGNORECASE)
SOLUTION_RE = re.compile(r"^Solution\s+to\s+Question\s+(\d+)\s*:?\s*(.*)$", re.IGNORECASE)
OPTION_RE = re.compile(r"^([a-e])\)\s*(.*)$", re.IGNORECASE)


CHAPTER_RULES: dict[str, dict[str, list[str]]] = {
    "Anatomy": {
        "Embryology": [
            "embryo",
            "notochord",
            "pharyngeal pouch",
            "neural crest",
            "neural tube",
            "heart bulge",
            "fontanelle",
            "development",
            "derivative",
            "branchial",
            "congenital",
        ],
        "Neuroanatomy": [
            "brainstem",
            "cerebellum",
            "cortex",
            "hippocampus",
            "corpus callosum",
            "optic chiasma",
            "red nucleus",
            "pyramidal",
            "spinal cord",
            "cranial nerve",
            "thalamus",
            "basal ganglia",
            "tract",
            "foramen magnum",
        ],
        "Head and Neck": [
            "mandibular",
            "trigeminal",
            "laryngeal",
            "pharynx",
            "thyroid",
            "parotid",
            "tonsil",
            "neck",
            "carotid",
            "facial artery",
            "foramen ovale",
            "superior orbital fissure",
            "cranial",
            "tongue",
        ],
        "Thorax": [
            "diaphragm",
            "aorta",
            "vena cava",
            "lung",
            "thorax",
            "mediastinum",
            "heart",
            "rib",
            "pleura",
            "intercostal",
        ],
        "Abdomen": [
            "epiploic",
            "liver",
            "gall bladder",
            "stomach",
            "pancreas",
            "portal vein",
            "omentum",
            "inguinal",
            "abdomen",
            "colon",
            "spleen",
            "kidney",
        ],
        "Pelvis and Perineum": [
            "pelvic",
            "perineum",
            "levator ani",
            "pudendal",
            "uterus",
            "prostate",
            "internal iliac",
            "anal sphincter",
            "rectum",
        ],
        "Upper Limb": [
            "ulnar nerve",
            "radial nerve",
            "axillary",
            "humerus",
            "scapula",
            "brachial",
            "clavicle",
            "shoulder",
            "forearm",
            "hand",
        ],
        "Lower Limb": [
            "femoral",
            "tibial",
            "peroneal",
            "talus",
            "calcaneus",
            "foot",
            "leg",
            "knee",
            "ankle",
            "gluteal",
        ],
        "Histology": [
            "electron micrograph",
            "histology",
            "epithelium",
            "gland",
            "secretory vesicle",
            "ribosome",
            "golgi",
            "mitochondria",
            "lymph node",
            "purkinje cell",
        ],
        "General Anatomy": ["joint", "collagen", "muscle", "fascia", "ligament", "bone", "cartilage"],
    },
    "Physiology": {
        "Nerve and Muscle": ["tetan", "muscle", "action potential", "neuromuscular", "synapse", "nerve"],
        "Blood": ["hemoglobin", "anaemia", "rbc", "wbc", "platelet", "coagulation", "blood group"],
        "Cardiovascular System": ["cardiac", "ecg", "blood pressure", "heart rate", "baroreceptor", "stroke volume"],
        "Respiratory System": ["oxygen", "co2", "ventilation", "lung", "spirometry", "dead space"],
        "Renal Physiology": ["gfr", "renal", "kidney", "nephron", "urine", "clearance", "tubule"],
        "Gastrointestinal Physiology": ["gastric", "intestinal", "bile", "pancreatic", "motility", "secretin"],
        "Endocrine Physiology": ["thyroid", "insulin", "cortisol", "pituitary", "hormone", "parathyroid"],
        "CNS and Special Senses": ["visual", "hearing", "vestibular", "cerebellum", "sleep", "pain", "reflex"],
        "Reproductive Physiology": ["menstrual", "ovulation", "pregnancy", "sperm", "testosterone", "estrogen"],
    },
    "Biochemistry": {
        "Carbohydrate Metabolism": ["glycolysis", "glycogen", "gluconeogenesis", "hmp", "fructose", "galactose"],
        "Lipid Metabolism": ["cholesterol", "fatty acid", "lipoprotein", "ketone", "triglyceride", "beta oxidation"],
        "Protein and Amino Acids": ["amino acid", "urea cycle", "phenylalanine", "tyrosine", "protein", "collagen"],
        "Vitamins": ["vitamin", "thiamine", "riboflavin", "niacin", "folate", "cobalamin", "biotin"],
        "Enzymes": ["enzyme", "kinase", "inhibitor", "km", "vmax", "cofactor"],
        "Molecular Biology": ["dna", "rna", "replication", "transcription", "translation", "pcr", "mutation"],
        "Genetics": ["chromosome", "inheritance", "pedigree", "gene", "genetic", "trisomy"],
        "Nutrition": ["nutrition", "malnutrition", "bmi", "calorie", "protein energy"],
    },
    "Pharmacology": {
        "General Pharmacology": ["half life", "first-order", "bioavailability", "volume of distribution", "clearance", "receptor"],
        "Autonomic Pharmacology": ["adrenergic", "cholinergic", "atropine", "beta blocker", "muscarinic", "sympathetic"],
        "Cardiovascular Drugs": ["antihypertensive", "antiarrhythmic", "statin", "heart failure", "nitrate", "digoxin"],
        "CNS Drugs": ["antiepileptic", "antipsychotic", "sedative", "opioid", "anesthetic", "antidepressant"],
        "Antimicrobials": ["antibiotic", "antitubercular", "antileprotic", "aminoglycoside", "cephalosporin", "macrolide"],
        "Endocrine Drugs": ["insulin", "thyroid", "steroid", "contraceptive", "glucocorticoid"],
        "Chemotherapy": ["anticancer", "methotrexate", "cisplatin", "doxorubicin", "chemotherapy"],
        "Autacoids and NSAIDs": ["histamine", "prostaglandin", "nsaid", "leukotriene", "serotonin"],
    },
    "Microbiology": {
        "Bacteriology": ["staphylococcus", "streptococcus", "mycobacter", "clostridium", "vibrio", "salmonella", "bacteria"],
        "Virology": ["virus", "hiv", "hepatitis", "influenza", "herpes", "rabies", "covid"],
        "Mycology": ["fungal", "candida", "aspergillus", "cryptococcus", "mucor", "dermatophyte"],
        "Parasitology": ["parasite", "malaria", "plasmodium", "leishmania", "amoeba", "helminth", "filaria"],
        "Immunology": ["antibody", "complement", "hypersensitivity", "vaccine", "immunoglobulin", "t cell", "b cell"],
        "General Microbiology": ["culture", "stain", "sterilization", "microscope", "gram", "media"],
    },
    "Pathology": {
        "General Pathology": ["inflammation", "necrosis", "apoptosis", "granuloma", "repair", "edema"],
        "Neoplasia": ["tumor", "carcinoma", "sarcoma", "oncogene", "metastasis", "neoplasia"],
        "Hematology": ["anemia", "leukemia", "lymphoma", "platelet", "coagulation", "hemophilia", "aplastic"],
        "Cardiovascular Pathology": ["atherosclerosis", "myocardial", "vasculitis", "aneurysm", "rheumatic heart"],
        "Respiratory Pathology": ["pneumonia", "copd", "asthma", "lung", "ards", "tuberculosis"],
        "Renal Pathology": ["glomerul", "nephrotic", "nephritic", "kidney", "renal"],
        "GIT and Liver Pathology": ["cirrhosis", "hepatitis", "colon", "stomach", "intestine", "pancreas"],
        "Endocrine Pathology": ["thyroid", "adrenal", "pituitary", "diabetes", "parathyroid"],
    },
    "Community Medicine": {
        "Epidemiology": ["incidence", "prevalence", "cohort", "case control", "odds ratio", "relative risk", "epidemiology"],
        "Biostatistics": ["mean", "median", "standard deviation", "sensitivity", "specificity", "p value", "confidence interval"],
        "Screening": ["screening", "lead time", "lag time", "predictive value"],
        "National Health Programs": ["national programme", "nlep", "rntcp", "nvbdcp", "nhm", "npcdcs"],
        "Immunization": ["vaccine", "immunization", "cold chain", "schedule", "bcg", "opv"],
        "Nutrition": ["nutrition", "vitamin", "malnutrition", "iodine", "anemia", "bmi"],
        "Environment and Sanitation": ["water", "air pollution", "sanitation", "waste", "vector", "chlorination"],
        "Demography and Family Planning": ["population", "fertility", "contraceptive", "mortality", "birth rate"],
        "Occupational Health": ["occupation", "silicosis", "asbestosis", "lead poisoning", "factory"],
    },
    "Forensic Medicine": {
        "Identification": ["identification", "fingerprint", "dna", "age", "sex", "stature"],
        "Injuries": ["injury", "wound", "abrasion", "contusion", "laceration", "firearm", "burn"],
        "Asphyxia": ["asphyxia", "hanging", "strangulation", "drowning", "suffocation"],
        "Toxicology": ["poison", "toxicity", "organophosphate", "arsenic", "cyanide", "snake bite"],
        "Sexual Offences": ["rape", "sexual", "hymen", "pregnancy", "paternity"],
        "Medical Jurisprudence": ["consent", "negligence", "ipc", "court", "autopsy", "inquest"],
    },
    "Ophthalmology": {
        "Optics and Refraction": ["refraction", "myopia", "hypermetropia", "astigmatism", "lens power"],
        "Cornea and Conjunctiva": ["cornea", "conjunctiva", "keratitis", "trachoma", "pterygium"],
        "Lens and Cataract": ["cataract", "lens", "aphakia", "pseudophakia"],
        "Glaucoma": ["glaucoma", "intraocular pressure", "angle closure", "trabecular"],
        "Retina": ["retina", "macula", "diabetic retinopathy", "retinal detachment", "fundus"],
        "Uvea": ["uveitis", "iris", "ciliary", "choroid"],
        "Neuro-ophthalmology": ["optic nerve", "visual field", "papilledema", "pupil", "diplopia"],
        "Ocular Trauma and Orbit": ["trauma", "orbit", "foreign body", "blow out", "proptosis"],
    },
    "ENT": {
        "Ear": ["ear", "otitis", "hearing", "mastoid", "tympanic", "ossicle", "vertigo", "meniere"],
        "Nose and Paranasal Sinuses": ["nose", "nasal", "sinus", "epistaxis", "rhinitis", "polyp"],
        "Throat and Larynx": ["larynx", "vocal cord", "pharynx", "tonsil", "dysphagia", "stridor"],
        "Head and Neck": ["neck", "thyroid", "salivary", "parotid", "lymph node"],
    },
    "Anesthesia": {
        "General Anesthesia": ["general anesthesia", "inhalational", "propofol", "ketamine", "volatile"],
        "Regional Anesthesia": ["spinal", "epidural", "nerve block", "local anesthetic", "bupivacaine"],
        "Airway": ["airway", "intubation", "laryngoscope", "endotracheal", "mallampati"],
        "Monitoring and Critical Care": ["monitoring", "pulse oximetry", "capnography", "ventilator", "shock"],
        "Pain Medicine": ["pain", "opioid", "analgesia", "postoperative"],
    },
    "Dermatology": {
        "Infections": ["tinea", "scabies", "herpes", "warts", "leprosy", "impetigo", "fungal"],
        "Inflammatory Dermatoses": ["psoriasis", "eczema", "lichen planus", "dermatitis", "urticaria"],
        "Autoimmune and Bullous": ["pemphigus", "pemphigoid", "lupus", "bullous", "vasculitis"],
        "Pigmentary Disorders": ["vitiligo", "melasma", "pigment", "albinism"],
        "Hair and Nail": ["alopecia", "nail", "hair", "onychomycosis"],
        "STIs": ["syphilis", "gonorrhea", "chancroid", "genital", "sti"],
    },
    "Psychiatry": {
        "Psychotic Disorders": ["schizophrenia", "delusion", "hallucination", "psychosis"],
        "Mood Disorders": ["depression", "mania", "bipolar", "mood", "suicide"],
        "Anxiety and Stress Disorders": ["anxiety", "panic", "phobia", "ocd", "ptsd"],
        "Substance Use": ["alcohol", "opioid", "cannabis", "withdrawal", "dependence"],
        "Child Psychiatry": ["autism", "adhd", "child", "intellectual disability"],
        "Organic Psychiatry": ["delirium", "dementia", "amnesia", "organic"],
        "Personality and Sleep": ["personality", "sleep", "insomnia", "narcolepsy"],
    },
    "Radiology": {
        "X-ray and Fluoroscopy": ["x-ray", "radiograph", "fluoroscopy", "chest xray"],
        "CT and MRI": ["ct", "mri", "computed tomography", "magnetic resonance"],
        "Ultrasound": ["ultrasound", "doppler", "sonography", "usg"],
        "Nuclear Medicine": ["pet", "spect", "radioisotope", "nuclear"],
        "Interventional Radiology": ["angiography", "embolization", "interventional", "catheter"],
        "Contrast and Safety": ["contrast", "barium", "iodinated", "gadolinium"],
    },
    "Medicine": {
        "Cardiology": ["myocardial", "ecg", "arrhythmia", "heart failure", "endocarditis", "cardiac", "acs"],
        "Respiratory Medicine": ["asthma", "copd", "pneumonia", "ards", "pleural", "pulmonary", "tb"],
        "Neurology": ["stroke", "seizure", "neuropathy", "myasthenia", "parkinson", "meningitis", "cns"],
        "Endocrinology": ["diabetes", "thyroid", "adrenal", "pituitary", "cushing", "insulin"],
        "Nephrology": ["renal", "kidney", "dialysis", "nephrotic", "nephritic", "electrolyte"],
        "Gastroenterology and Hepatology": ["hepatitis", "cirrhosis", "pancreatitis", "ibd", "diarrhea", "gi bleed"],
        "Hematology": ["anemia", "leukemia", "lymphoma", "hemophilia", "thrombosis"],
        "Infectious Diseases": ["fever", "hiv", "malaria", "dengue", "sepsis", "infection", "antibiotic"],
        "Rheumatology": ["sle", "arthritis", "vasculitis", "gout", "scleroderma"],
        "Emergency and Critical Care": ["shock", "poisoning", "coma", "icu", "resuscitation", "ventilator"],
    },
    "Surgery": {
        "Gastrointestinal Surgery": ["appendicitis", "hernia", "intestinal obstruction", "colon", "stomach", "peritonitis"],
        "Hepatobiliary and Pancreas": ["gallstone", "bile duct", "pancreas", "liver", "jaundice"],
        "Urology": ["prostate", "renal stone", "testis", "bladder", "ureter", "urology"],
        "Vascular Surgery": ["aneurysm", "varicose", "ischemia", "artery", "vein", "vascular"],
        "Trauma and Burns": ["trauma", "burn", "fracture", "wound", "atls"],
        "Breast and Endocrine Surgery": ["breast", "thyroid", "parathyroid", "adrenal"],
        "Neurosurgery": ["head injury", "subdural", "hydrocephalus", "brain tumor"],
    },
    "Orthopedics": {
        "Trauma and Fractures": ["fracture", "dislocation", "cast", "splint", "trauma"],
        "Spine": ["spine", "vertebra", "disc", "scoliosis", "kyphosis"],
        "Bone Tumors": ["osteosarcoma", "ewing", "giant cell", "bone tumor"],
        "Infections": ["osteomyelitis", "septic arthritis", "tuberculosis", "pott"],
        "Pediatric Orthopedics": ["clubfoot", "ddh", "perthes", "slipped capital"],
        "Joint Disorders": ["arthritis", "knee", "hip", "shoulder", "meniscus"],
        "Metabolic Bone Disease": ["rickets", "osteoporosis", "osteomalacia", "paget"],
    },
    "Paediatrics": {
        "Neonatology": ["neonate", "newborn", "premature", "nicu", "jaundice", "apgar"],
        "Growth and Development": ["development", "milestone", "growth", "puberty"],
        "Nutrition": ["nutrition", "breastfeeding", "malnutrition", "vitamin", "weaning"],
        "Infectious Diseases": ["fever", "vaccine", "measles", "pertussis", "infection"],
        "Respiratory": ["bronchiolitis", "asthma", "pneumonia", "croup"],
        "Cardiology": ["cyanotic", "congenital heart", "tetralogy", "pda", "vsd"],
        "Neurology": ["seizure", "cerebral palsy", "meningitis", "hydrocephalus"],
        "Hematology and Oncology": ["anemia", "thalassemia", "leukemia", "hemophilia"],
        "Nephrology": ["nephrotic", "renal", "uti", "glomerulonephritis"],
    },
    "Obstetrics and Gynecology": {
        "Antenatal Care": ["antenatal", "pregnancy", "trimester", "prenatal", "fetus"],
        "Labor and Delivery": ["labor", "delivery", "partograph", "forceps", "breech", "cesarean"],
        "Obstetric Complications": ["pre-eclampsia", "eclampsia", "pph", "placenta", "abruption", "rupture uterus"],
        "Medical Disorders in Pregnancy": ["diabetes in pregnancy", "hypertension", "anemia in pregnancy", "heart disease"],
        "Gynecology": ["fibroid", "endometriosis", "pcos", "menorrhagia", "ovary", "uterus"],
        "Infertility and Reproductive Endocrinology": ["infertility", "ovulation", "ivf", "amenorrhea", "hormone"],
        "Contraception": ["contraception", "iucd", "ocp", "sterilization", "condom"],
        "Gynecologic Oncology": ["cervical cancer", "endometrial cancer", "ovarian cancer", "pap smear", "hpv"],
    },
}


@dataclass
class PageRecord:
    page_no: int
    lines: list[str]
    heading: dict[str, Any] | None


def decode_text(text: str) -> str:
    decoded: list[str] = []
    for char in text:
        code = ord(char)
        if 0xE000 <= code <= 0xE0FF:
            decoded.append(chr(code - 0xE000 + 0x20))
        else:
            decoded.append(char)
    return "".join(decoded)


def normalize_subject(raw: str) -> str:
    key = raw.strip().lower()
    return SUBJECT_ALIASES.get(key, raw.strip())


def clean_spacing(text: str) -> str:
    text = text.replace("\x7f", "-")
    text = re.sub(r"\s+", " ", text)
    text = re.sub(r"\s+([,.;:?])", r"\1", text)
    text = re.sub(r"\(\s+", "(", text)
    text = re.sub(r"\s+\)", ")", text)
    return text.strip()


def normalize_lines(raw_text: str, page_no: int) -> list[str]:
    text = decode_text(raw_text or "").replace("\u00a0", " ").replace("\x00", "")
    raw_lines = [line.strip() for line in text.splitlines()]
    lines: list[str] = []
    for line in raw_lines:
        line = clean_spacing(line)
        if not line:
            continue
        if line == str(page_no):
            continue
        lines.append(line)

    fixed: list[str] = []
    index = 0
    while index < len(lines):
        line = lines[index]
        if len(line) == 1 and line.isalpha() and index + 1 < len(lines):
            nxt = lines[index + 1].lstrip()
            if nxt and re.match(r"^[a-z-]", nxt):
                lines[index + 1] = line + nxt
                index += 1
                continue
        fixed.append(line)
        index += 1

    return fixed


def parse_heading(lines: list[str]) -> dict[str, Any] | None:
    if not lines:
        return None
    sample = clean_spacing(" ".join(lines[:4]))
    sample = re.split(r"\s+Question\s+\d+\s*:?", sample, maxsplit=1, flags=re.IGNORECASE)[0]
    match = HEADING_RE.match(sample)
    if not match:
        return None
    subject, exam, year, tail = match.groups()
    subject = normalize_subject(subject)
    full_title = clean_spacing(f"{subject} {exam} {year}{tail}")
    display_exam = exam.upper()
    if exam.upper() == "AIIMS" and "INI-CET" in full_title.upper():
        display_exam = "AIIMS/INI-CET"
    return {
        "subject": subject,
        "exam": display_exam,
        "year": int(year),
        "paper": full_title,
    }


def extract_pages(reader: PdfReader) -> list[PageRecord]:
    pages: list[PageRecord] = []
    for index, page in enumerate(reader.pages, start=1):
        try:
            lines = normalize_lines(page.extract_text() or "", index)
        except Exception as exc:  # pragma: no cover - defensive for malformed pages
            print(f"warning: failed text extraction on page {index}: {exc}", file=sys.stderr)
            lines = []
        pages.append(PageRecord(page_no=index, lines=lines, heading=parse_heading(lines)))
    return pages


def extract_images(reader: PdfReader, media_dir: Path, rel_prefix: str) -> dict[int, list[dict[str, str]]]:
    media_dir.mkdir(parents=True, exist_ok=True)
    logging.getLogger("pypdf").setLevel(logging.ERROR)
    page_images: dict[int, list[dict[str, str]]] = {}
    for page_index, page in enumerate(reader.pages, start=1):
        refs: list[dict[str, str]] = []
        try:
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                images = list(page.images)
        except Exception as exc:
            print(f"warning: failed image listing on page {page_index}: {exc}", file=sys.stderr)
            images = []
        for image_index, image in enumerate(images):
            suffix = Path(getattr(image, "name", "") or "").suffix.lower()
            if suffix not in {".jpg", ".jpeg", ".png", ".jp2", ".bmp", ".tif", ".tiff"}:
                suffix = ".jpg"
            filename = f"p{page_index:04d}_{image_index:02d}{suffix}"
            target = media_dir / filename
            try:
                target.write_bytes(image.data)
            except Exception as exc:
                print(f"warning: failed image extraction on page {page_index}: {exc}", file=sys.stderr)
                continue
            refs.append({"src": f"{rel_prefix.rstrip('/')}/{filename}", "page": str(page_index)})
        if refs:
            page_images[page_index] = refs
    return page_images


def slugify(value: str) -> str:
    value = value.lower()
    value = re.sub(r"[^a-z0-9]+", "-", value)
    return value.strip("-") or "item"


def join_lines(lines: list[str]) -> str:
    return clean_spacing(" ".join(line for line in lines if line))


def parse_question_text(lines: list[str]) -> tuple[str, list[str]]:
    stem_lines: list[str] = []
    option_lines: dict[str, list[str]] = {}
    active_label: str | None = None
    for line in lines:
        match = OPTION_RE.match(line)
        if match:
            active_label = match.group(1).lower()
            option_lines[active_label] = [match.group(2).strip()]
            continue
        if active_label:
            option_lines.setdefault(active_label, []).append(line)
        else:
            stem_lines.append(line)

    labels = ["a", "b", "c", "d", "e"]
    options = [join_lines(option_lines[label]) for label in labels if label in option_lines]
    return join_lines(stem_lines), options


def parse_answer_key(lines: list[str]) -> dict[int, int]:
    blob = join_lines(lines)
    if not blob:
        return {}
    blob = re.sub(r"Question\s+No\.?\s+Correct\s+Option", " ", blob, flags=re.IGNORECASE)
    answer_key: dict[int, int] = {}
    label_to_index = {"a": 0, "b": 1, "c": 2, "d": 3, "e": 4}
    for qno, label in re.findall(r"\b(\d{1,3})\s+([a-e])\b", blob, flags=re.IGNORECASE):
        answer_key[int(qno)] = label_to_index[label.lower()]
    return answer_key


def marker_value(text: str) -> str | None:
    normalized = text.strip().lower()
    if normalized in {"a", "b", "c", "d", "e", "1", "2", "3", "4", "5"}:
        return normalized
    return None


def normalize_for_match(text: str) -> str:
    text = decode_text(text)
    text = text.lower()
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def infer_answer(options: list[str], explanation: str) -> tuple[int | None, str]:
    if not options or not explanation:
        return None, "missing"

    first = explanation[:1200]
    first_norm = normalize_for_match(first)
    marker_options = [marker_value(option) for option in options]
    all_markers = all(value is not None for value in marker_options)

    if all_markers:
        marker_patterns = [
            r"marked\s+(?:as|with)?\s*[\"'`]?([a-e1-5])[\"'`]?",
            r"[\"'`]([a-e1-5])[\"'`]\s+(?:points|represents|is|shows)",
            r"option\s+([a-e1-5])\b",
            r"\b([a-e1-5])\s+(?:points\s+to|represents)\b",
        ]
        for pattern in marker_patterns:
            match = re.search(pattern, first, re.IGNORECASE)
            if not match:
                continue
            value = match.group(1).lower()
            for index, option_value in enumerate(marker_options):
                if option_value == value:
                    return index, "marker"
        normalized_marker_patterns = [
            r"marked\s+(?:as\s+|with\s+)?([a-e1-5])\b",
            r"image\s+marked\s+([a-e1-5])\b",
            r"\b([a-e1-5])\s+(?:points\s+to|represents|depicts|shows)\b",
        ]
        for pattern in normalized_marker_patterns:
            match = re.search(pattern, first_norm, re.IGNORECASE)
            if not match:
                continue
            value = match.group(1).lower()
            for index, option_value in enumerate(marker_options):
                if option_value == value:
                    return index, "marker"

    explicit = re.search(
        r"(?:correct\s+answer|answer|most\s+appropriate\s+answer)\D{0,40}\b([a-e])\b",
        first,
        re.IGNORECASE,
    )
    if explicit:
        label = explicit.group(1).lower()
        labels = ["a", "b", "c", "d", "e"]
        if label in labels[: len(options)]:
            return labels.index(label), "explicit"

    stop_words = {"a", "an", "and", "are", "as", "by", "for", "in", "is", "of", "on", "or", "the", "to", "with"}
    candidates: list[tuple[int, int, int]] = []
    other_pos = first_norm.find("other options")
    for index, option in enumerate(options):
        option_norm = normalize_for_match(option)
        if len(option_norm) < 4:
            continue
        pos = first_norm.find(option_norm)
        if pos < 0:
            words = option_norm.split()
            if len(words) >= 2:
                pos = first_norm.find(" ".join(words[: min(4, len(words))]))
        if pos >= 0:
            if other_pos >= 0 and pos > other_pos:
                pos += 5000
            candidates.append((pos, -len(option_norm), index))
            continue

        tokens = [token for token in option_norm.split() if token not in stop_words and len(token) >= 3]
        if not tokens:
            continue
        positions = [first_norm.find(token) for token in tokens]
        hits = [position for position in positions if position >= 0]
        minimum_hits = 1 if len(tokens) == 1 and len(tokens[0]) >= 7 else max(2, (len(tokens) + 1) // 2)
        if len(hits) >= minimum_hits:
            pos = min(hits)
            if other_pos >= 0 and pos > other_pos:
                pos += 5000
            candidates.append((pos, -sum(len(token) for token in tokens), index))

    if candidates:
        candidates.sort()
        return candidates[0][2], "phrase"

    return None, "unresolved"


def classify_chapter(subject: str, blob: str) -> tuple[str, str, list[str]]:
    rules = CHAPTER_RULES.get(subject, {})
    blob_norm = normalize_for_match(blob)
    scores: list[tuple[int, str, list[str]]] = []
    for chapter, keywords in rules.items():
        matched: list[str] = []
        score = 0
        for keyword in keywords:
            key_norm = normalize_for_match(keyword)
            if not key_norm:
                continue
            count = blob_norm.count(key_norm)
            if count:
                matched.append(keyword)
                score += count * max(1, len(key_norm.split()))
        if score:
            scores.append((score, chapter, matched))

    if not scores:
        return "General / Mixed", "Core concepts", []
    scores.sort(key=lambda item: (-item[0], item[1]))
    _, chapter, matched = scores[0]
    concepts = []
    for keyword in matched:
        label = " ".join(part.capitalize() for part in keyword.split())
        if label not in concepts:
            concepts.append(label)
    subtopic = concepts[0] if concepts else "Core concepts"
    return chapter, subtopic, concepts[:6]


def is_image_question(question: str, options: list[str]) -> bool:
    blob = f"{question} {' '.join(options)}".lower()
    image_words = [
        "image",
        "marked",
        "arrow",
        "asterisk",
        "below",
        "radiograph",
        "x-ray",
        "xray",
        "ct",
        "mri",
        "ultrasound",
        "histopath",
        "electron micrograph",
        "identify",
    ]
    if any(word in blob for word in image_words):
        return True
    markers = [marker_value(option) for option in options]
    return bool(options) and all(value is not None for value in markers)


def difficulty_for(question: str, explanation: str, image_based: bool) -> str:
    length = len(question) + min(len(explanation), 900)
    if image_based or length > 900 or re.search(r"\bexcept\b|\ball of the following\b", question, re.I):
        return "Difficult"
    if length < 260:
        return "Easy"
    return "Moderate"


def parse_sections(
    pages: list[PageRecord],
    page_images: dict[int, list[dict[str, str]]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    sections: list[dict[str, Any]] = []
    starts = [index for index, page in enumerate(pages) if page.heading]

    for section_pos, start_index in enumerate(starts):
        end_index = starts[section_pos + 1] if section_pos + 1 < len(starts) else len(pages)
        heading = pages[start_index].heading or {}
        records: dict[tuple[str, int], dict[str, Any]] = {}
        mode: str | None = None
        number: int | None = None
        buffer: list[str] = []
        buffer_pages: list[int] = []
        answer_key_lines: list[str] = []
        collecting_answer_key = False

        def flush() -> None:
            nonlocal mode, number, buffer, buffer_pages
            if mode and number is not None and buffer:
                records[(mode, number)] = {
                    "lines": buffer[:],
                    "pages": sorted(set(buffer_pages)),
                }
            mode = None
            number = None
            buffer = []
            buffer_pages = []

        for page in pages[start_index:end_index]:
            for line in page.lines:
                if parse_heading([line]):
                    continue
                if collecting_answer_key:
                    if re.search(r"Detailed\s+Explanations", line, re.IGNORECASE):
                        before = re.split(r"Detailed\s+Explanations", line, maxsplit=1, flags=re.IGNORECASE)[0]
                        if before.strip():
                            answer_key_lines.append(before.strip())
                        collecting_answer_key = False
                    else:
                        answer_key_lines.append(line)
                    continue
                if re.search(r"\bAnswer\s+Key\b", line, re.IGNORECASE):
                    before, after = re.split(r"\bAnswer\s+Key\b", line, maxsplit=1, flags=re.IGNORECASE)
                    if before.strip() and mode:
                        buffer.append(before.strip())
                        buffer_pages.append(page.page_no)
                    flush()
                    collecting_answer_key = True
                    if re.search(r"Detailed\s+Explanations", after, re.IGNORECASE):
                        key_part = re.split(r"Detailed\s+Explanations", after, maxsplit=1, flags=re.IGNORECASE)[0]
                        if key_part.strip():
                            answer_key_lines.append(key_part.strip())
                        collecting_answer_key = False
                    elif after.strip():
                        answer_key_lines.append(after.strip())
                    continue
                sol_match = SOLUTION_RE.match(line)
                q_match = QUESTION_RE.match(line)
                if sol_match:
                    flush()
                    mode = "solution"
                    number = int(sol_match.group(1))
                    rest = sol_match.group(2).strip()
                    if rest:
                        buffer.append(rest)
                        buffer_pages.append(page.page_no)
                    continue
                if q_match:
                    flush()
                    mode = "question"
                    number = int(q_match.group(1))
                    rest = q_match.group(2).strip()
                    if rest:
                        buffer.append(rest)
                        buffer_pages.append(page.page_no)
                    continue
                if mode:
                    buffer.append(line)
                    buffer_pages.append(page.page_no)
        flush()
        answer_key = parse_answer_key(answer_key_lines)

        question_numbers = sorted(number for kind, number in records if kind == "question")
        used_media: set[str] = set()
        section_questions: list[dict[str, Any]] = []
        for qno in question_numbers:
            question_record = records.get(("question", qno), {"lines": [], "pages": []})
            solution_record = records.get(("solution", qno), {"lines": [], "pages": []})
            question, options = parse_question_text(question_record["lines"])
            explanation = join_lines(solution_record["lines"])
            if not question and not options:
                continue

            answer_index, answer_confidence = infer_answer(options, explanation)
            if qno in answer_key:
                answer_index = answer_key[qno]
                answer_confidence = "answer_key"
            image_based = is_image_question(question, options)
            source_pages = question_record["pages"]
            explanation_pages = solution_record["pages"]
            source_media: list[dict[str, str]] = []
            for page_no in source_pages + explanation_pages:
                for ref in page_images.get(page_no, []):
                    if ref not in source_media:
                        source_media.append(ref)

            question_images: list[dict[str, str]] = []
            if image_based:
                for page_no in source_pages:
                    for ref in page_images.get(page_no, []):
                        if ref["src"] not in used_media:
                            question_images.append(ref)
                            used_media.add(ref["src"])
                            break
                    if question_images:
                        break

            blob = f"{question} {' '.join(options)} {explanation[:1400]}"
            chapter, subtopic, concepts = classify_chapter(heading.get("subject", ""), blob)
            subject_slug = slugify(heading.get("subject", "subject"))
            exam_slug = slugify(heading.get("exam", "exam"))
            qid = f"{subject_slug}-{exam_slug}-{heading.get('year', 'year')}-q{qno:03d}"
            stable_hash = hashlib.sha1(f"{heading.get('paper')}|{qno}|{question}".encode("utf-8")).hexdigest()[:10]
            if qid in {item["id"] for item in section_questions}:
                qid = f"{qid}-{stable_hash}"

            tags = ["PYQ"]
            if image_based:
                tags.append("Image-based")
            if re.search(r"\bexcept\b|\bnot true\b|\bincorrect\b", question, re.I):
                tags.append("Negative question")

            item = {
                "id": qid,
                "source": "Marrow ED8 Previous Year Question Papers",
                "subject": heading.get("subject", "Unknown"),
                "chapter": chapter,
                "subtopic": subtopic,
                "exam": heading.get("exam", "Unknown"),
                "year": heading.get("year"),
                "paper": heading.get("paper", ""),
                "questionNo": qno,
                "question": question,
                "options": options,
                "correct": answer_index,
                "answerConfidence": answer_confidence,
                "explanation": explanation,
                "difficulty": difficulty_for(question, explanation, image_based),
                "repeatedCount": 1,
                "highYield": False,
                "concepts": concepts,
                "tags": tags,
                "sourcePages": source_pages,
                "explanationPages": explanation_pages,
                "images": question_images,
                "sourceMedia": source_media,
            }
            section_questions.append(item)

        sections.append(
            {
                "paper": heading.get("paper", ""),
                "subject": heading.get("subject", "Unknown"),
                "exam": heading.get("exam", "Unknown"),
                "year": heading.get("year"),
                "startPage": pages[start_index].page_no,
                "endPage": pages[end_index - 1].page_no if end_index > start_index else pages[start_index].page_no,
                "questionCount": len(section_questions),
            }
        )
        sections[-1]["_questions"] = section_questions

    questions: list[dict[str, Any]] = []
    for section in sections:
        questions.extend(section.pop("_questions"))

    signatures = Counter(normalize_for_match(item["question"])[:220] for item in questions)
    for item in questions:
        count = signatures[normalize_for_match(item["question"])[:220]]
        item["repeatedCount"] = count
        item["highYield"] = count >= 2 or item["year"] in {2023, 2024}
        if item["highYield"] and "High-yield" not in item["tags"]:
            item["tags"].append("High-yield")
        if count >= 2 and "Repeated" not in item["tags"]:
            item["tags"].append("Repeated")

    return questions, sections


def build_meta(questions: list[dict[str, Any]], sections: list[dict[str, Any]]) -> dict[str, Any]:
    subjects = sorted({item["subject"] for item in questions})
    exams = sorted({item["exam"] for item in questions})
    years = sorted({item["year"] for item in questions if item.get("year")})
    chapters: dict[str, list[str]] = {}
    for subject in subjects:
        chapters[subject] = sorted({item["chapter"] for item in questions if item["subject"] == subject})
    gradable = sum(1 for item in questions if item["correct"] is not None)
    image_based = sum(1 for item in questions if item["images"])
    return {
        "title": "MedVault PYQ",
        "generatedFrom": "Pyqs_ed8.pdf",
        "totalQuestions": len(questions),
        "gradableQuestions": gradable,
        "imageQuestions": image_based,
        "subjects": subjects,
        "exams": exams,
        "years": years,
        "chapters": chapters,
        "sections": sections,
    }


def write_js(path: Path, questions: list[dict[str, Any]], meta: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(questions, ensure_ascii=False, separators=(",", ":"))
    meta_payload = json.dumps(meta, ensure_ascii=False, separators=(",", ":"))
    path.write_text(
        "window.QUESTION_META="
        + meta_payload
        + ";\nwindow.QUESTION_BANK="
        + payload
        + ";\n",
        encoding="utf-8",
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pdf", required=True, help="Path to the source PDF")
    parser.add_argument("--out", default="data/questions.json", help="Structured JSON output")
    parser.add_argument("--js", default="assets/question-bank.js", help="Browser JS output")
    parser.add_argument("--media-dir", default="assets/media", help="Image output directory")
    parser.add_argument("--media-prefix", default="assets/media", help="Relative image path prefix used in app data")
    parser.add_argument("--no-images", action="store_true", help="Skip embedded image extraction")
    args = parser.parse_args()

    pdf_path = Path(args.pdf).expanduser()
    out_path = Path(args.out)
    js_path = Path(args.js)
    media_dir = Path(args.media_dir)

    reader = PdfReader(str(pdf_path))
    print(f"Reading {len(reader.pages)} pages from {pdf_path.name}...")
    pages = extract_pages(reader)
    print("Decoded text and headings.")

    page_images: dict[int, list[dict[str, str]]] = {}
    if not args.no_images:
        print("Extracting embedded images...")
        page_images = extract_images(reader, media_dir, args.media_prefix)
        image_count = sum(len(items) for items in page_images.values())
        print(f"Extracted {image_count} images from {len(page_images)} pages.")

    questions, sections = parse_sections(pages, page_images)
    meta = build_meta(questions, sections)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps({"meta": meta, "questions": questions}, ensure_ascii=False, indent=2), encoding="utf-8")
    write_js(js_path, questions, meta)

    unresolved = sum(1 for item in questions if item["correct"] is None)
    print(f"Wrote {len(questions)} questions to {out_path}")
    print(f"Wrote browser data to {js_path}")
    print(f"Gradable: {meta['gradableQuestions']} / {meta['totalQuestions']} | unresolved answers: {unresolved}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
