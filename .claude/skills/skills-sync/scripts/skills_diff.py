#!/usr/bin/env python3
"""Porovná lokální Claude skilly s verzí uloženou v GitHub repozitáři.

Vypíše přehled (nebo JSON s `--json`) se čtyřmi možnými stavy pro každý skill:

  identical  – lokální i repo verze jsou bajt po bajtu stejné
  only_local – skill existuje jen lokálně (chybí v repu)
  only_repo  – skill existuje jen v repu (chybí lokálně)
  differs    – existuje na obou místech, ale obsah se liší

Skript nic nemění. Zápis dělá až `apply_sync.py`.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path

# Skilly dodávané Anthropicem / harnessem. Nesynchronizují se, pokud nedáš --all.
BUILTIN_NAMES = {
    "artifact-capabilities",
    "artifact-design",
    "artifact-diagramming",
    "claude-api",
    "code-review",
    "dataviz",
    "docx",
    "fewer-permission-prompts",
    "init",
    "keybindings-help",
    "loop",
    "morning",
    "pdf",
    "pptx",
    "run",
    "security-review",
    "session-start-hook",
    "simplify",
    "skill-creator",
    "update-config",
    "xlsx",
}

IGNORE_DIR_NAMES = {".git", "__pycache__", "node_modules", ".pytest_cache", ".venv"}
IGNORE_FILE_NAMES = {".DS_Store", "Thumbs.db"}
IGNORE_SUFFIXES = {".pyc", ".pyo"}

DEFAULT_REPO_SLUG = "kolderbenjamin-sys/Claude-Code-Skills"
REPO_SKILLS_SUBDIR = Path(".claude/skills")


# --------------------------------------------------------------------------- #
# hledání cest
# --------------------------------------------------------------------------- #
def local_skill_roots() -> list[Path]:
    """Adresáře, které přímo obsahují složky se skilly, v pořadí priority."""
    roots: list[Path] = []
    env = os.environ.get("CLAUDE_SKILLS_DIR")
    if env:
        roots.append(Path(env).expanduser())
    home = Path.home() / ".claude" / "skills"
    roots.append(home / "synced")  # skilly synchronizované z claude.ai (Cowork)
    roots.append(home)  # ručně nainstalované skilly
    seen, out = set(), []
    for r in roots:
        rp = r.expanduser()
        if rp.is_dir() and rp not in seen:
            seen.add(rp)
            out.append(rp)
    return out


def load_manifest(roots: list[Path]) -> dict[str, str]:
    """name -> source ('custom' / 'anthropic' / 'anthropic-example') z manifest.json."""
    sources: dict[str, str] = {}
    for root in roots:
        mf = root / "manifest.json"
        if not mf.is_file():
            continue
        try:
            data = json.loads(mf.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue
        for entry in data.get("skills", []):
            name = entry.get("name")
            if name and name not in sources:
                sources[name] = entry.get("source", "unknown")
    return sources


def collect_skills(root: Path) -> dict[str, Path]:
    """name -> adresář skillu (složka obsahující SKILL.md) přímo pod `root`."""
    found: dict[str, Path] = {}
    if not root.is_dir():
        return found
    for child in sorted(root.iterdir()):
        if not child.is_dir() or child.name in IGNORE_DIR_NAMES:
            continue
        if (child / "SKILL.md").is_file():
            found[child.name] = child
    return found


def git_remote_url(path: Path) -> str | None:
    try:
        out = subprocess.run(
            ["git", "-C", str(path), "remote", "get-url", "origin"],
            capture_output=True, text=True, timeout=15,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    return out.stdout.strip() if out.returncode == 0 else None


def slug_matches(url: str, slug: str) -> bool:
    norm = url.lower().rstrip("/").removesuffix(".git")
    return norm.endswith(slug.lower())


def find_repo(explicit: str | None, slug: str) -> Path | None:
    """Najde lokální klon repozitáře se skilly."""
    if explicit:
        p = Path(explicit).expanduser()
        return p if p.is_dir() else None

    env = os.environ.get("SKILLS_REPO_DIR")
    if env and Path(env).expanduser().is_dir():
        return Path(env).expanduser()

    # aktuální adresář nebo některý z rodičů
    cur = Path.cwd().resolve()
    for candidate in [cur, *cur.parents]:
        if (candidate / ".git").exists():
            url = git_remote_url(candidate)
            if url and slug_matches(url, slug):
                return candidate
            break  # jsme v jiném gitovém repu, výš už nelezeme

    repo_name = slug.split("/")[-1]
    for candidate in (
        Path.home() / repo_name,
        Path.home() / "git" / repo_name,
        Path.home() / "projects" / repo_name,
        Path.home() / "Documents" / repo_name,
        Path.home() / ".claude" / "skills-repo",
    ):
        if candidate.is_dir() and (candidate / ".git").exists():
            return candidate
    return None


# --------------------------------------------------------------------------- #
# porovnání obsahu
# --------------------------------------------------------------------------- #
def hash_tree(root: Path) -> dict[str, str]:
    """relativní cesta -> sha256, rekurzivně, s vynecháním balastu."""
    result: dict[str, str] = {}
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in IGNORE_DIR_NAMES]
        for fname in filenames:
            if fname in IGNORE_FILE_NAMES or Path(fname).suffix in IGNORE_SUFFIXES:
                continue
            full = Path(dirpath) / fname
            if full.is_symlink() or not full.is_file():
                continue
            digest = hashlib.sha256()
            with full.open("rb") as fh:
                for chunk in iter(lambda: fh.read(65536), b""):
                    digest.update(chunk)
            result[str(full.relative_to(root))] = digest.hexdigest()
    return result


def compare_skill(local: Path, repo: Path) -> dict:
    lh, rh = hash_tree(local), hash_tree(repo)
    only_local = sorted(set(lh) - set(rh))
    only_repo = sorted(set(rh) - set(lh))
    changed = sorted(f for f in set(lh) & set(rh) if lh[f] != rh[f])
    return {
        "files_only_local": only_local,
        "files_only_repo": only_repo,
        "files_changed": changed,
        "identical": not (only_local or only_repo or changed),
    }


# --------------------------------------------------------------------------- #
def build_report(args) -> dict:
    roots = local_skill_roots()
    sources = load_manifest(roots)

    local_skills: dict[str, Path] = {}
    duplicates: list[dict] = []
    for root in roots:
        for name, path in collect_skills(root).items():
            if name in local_skills:
                duplicates.append({"name": name, "kept": str(local_skills[name]), "ignored": str(path)})
            else:
                local_skills[name] = path

    repo_root = find_repo(args.repo, args.slug)
    repo_skills: dict[str, Path] = {}
    if repo_root:
        repo_skills = collect_skills(repo_root / REPO_SKILLS_SUBDIR)

    excluded = set(args.exclude or [])

    def is_custom(name: str) -> bool:
        src = sources.get(name)
        if src is not None:
            return src == "custom"
        return name not in BUILTIN_NAMES  # bez manifestu: heuristika

    entries = []
    for name in sorted(set(local_skills) | set(repo_skills)):
        if name in excluded:
            continue
        custom = is_custom(name)
        if not custom and not args.all:
            continue
        lp, rp = local_skills.get(name), repo_skills.get(name)
        entry = {
            "name": name,
            "source": sources.get(name, "unknown"),
            "local_path": str(lp) if lp else None,
            "repo_path": str(rp) if rp else None,
        }
        if lp and rp:
            detail = compare_skill(lp, rp)
            entry["status"] = "identical" if detail.pop("identical") else "differs"
            entry.update(detail)
        elif lp:
            entry["status"] = "only_local"
        else:
            entry["status"] = "only_repo"
        entries.append(entry)

    return {
        "local_roots": [str(r) for r in roots],
        "repo_root": str(repo_root) if repo_root else None,
        "repo_skills_dir": str(repo_root / REPO_SKILLS_SUBDIR) if repo_root else None,
        "manifest_found": bool(sources),
        "duplicates": duplicates,
        "include_builtins": bool(args.all),
        "skills": entries,
    }


LABELS = {
    "identical": "OK      ",
    "differs": "LIŠÍ SE ",
    "only_local": "JEN LOKÁL",
    "only_repo": "JEN REPO",
}


def print_human(report: dict) -> None:
    print(f"Lokální kořeny : {', '.join(report['local_roots']) or '(žádný)'}")
    print(f"Repo           : {report['repo_root'] or '(NENALEZENO)'}")
    print(f"manifest.json  : {'ano' if report['manifest_found'] else 'ne (použita heuristika)'}")
    if report["duplicates"]:
        print("\nPozor – skill je ve více lokálních kořenech, použit ten první:")
        for d in report["duplicates"]:
            print(f"  {d['name']}: použit {d['kept']}, ignorován {d['ignored']}")
    print()

    buckets: dict[str, list[dict]] = {}
    for e in report["skills"]:
        buckets.setdefault(e["status"], []).append(e)

    for status in ("differs", "only_local", "only_repo", "identical"):
        for e in buckets.get(status, []):
            line = f"{LABELS[status]}  {e['name']}"
            if status == "differs":
                bits = []
                if e["files_changed"]:
                    bits.append(f"změněno: {', '.join(e['files_changed'])}")
                if e["files_only_local"]:
                    bits.append(f"jen lokálně: {', '.join(e['files_only_local'])}")
                if e["files_only_repo"]:
                    bits.append(f"jen v repu: {', '.join(e['files_only_repo'])}")
                line += "  (" + "; ".join(bits) + ")"
            print(line)

    counts = {s: len(v) for s, v in buckets.items()}
    todo = counts.get("differs", 0) + counts.get("only_local", 0) + counts.get("only_repo", 0)
    print(f"\nCelkem {len(report['skills'])} skillů, k vyřešení {todo}.")


def main() -> int:
    ap = argparse.ArgumentParser(description="Porovná lokální skilly s GitHub repem.")
    ap.add_argument("--repo", help="cesta ke klonu repozitáře (jinak se hledá automaticky)")
    ap.add_argument("--slug", default=DEFAULT_REPO_SLUG, help="owner/repo pro autodetekci")
    ap.add_argument("--all", action="store_true", help="zahrnout i vestavěné Anthropic skilly")
    ap.add_argument("--exclude", nargs="*", help="jména skillů k vynechání")
    ap.add_argument("--json", action="store_true", help="vypsat JSON místo tabulky")
    args = ap.parse_args()

    report = build_report(args)
    if args.json:
        json.dump(report, sys.stdout, ensure_ascii=False, indent=2)
        print()
    else:
        print_human(report)

    if not report["repo_root"]:
        print(
            f"\nCHYBA: klon repozitáře {args.slug} nenalezen. "
            f"Naklonuj ho, nebo předej --repo /cesta/ke/klonu.",
            file=sys.stderr,
        )
        return 3
    return 0


if __name__ == "__main__":
    sys.exit(main())
