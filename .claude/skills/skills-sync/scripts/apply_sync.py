#!/usr/bin/env python3
"""Provede jednu synchronizační akci nad jedním skillem.

Směry:
  local-to-repo   zrcadlí lokální složku skillu do repa
  repo-to-local   zrcadlí složku z repa do lokálních skillů
  delete-repo     smaže skill z repa
  delete-local    smaže skill z lokálních skillů

Zrcadlení = zkopíruje soubory ZE zdroje a smaže v cíli ty, co ve zdroji nejsou,
takže cíl je po doběhnutí bajt po bajtu shodný se zdrojem.

Před každým zápisem se cíl zazálohuje do ~/.claude/skills-sync-backups/<čas>/.
Suchý běh: --dry-run.
"""

from __future__ import annotations

import argparse
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from skills_diff import (  # noqa: E402
    DEFAULT_REPO_SLUG,
    IGNORE_DIR_NAMES,
    IGNORE_FILE_NAMES,
    IGNORE_SUFFIXES,
    REPO_SKILLS_SUBDIR,
    collect_skills,
    find_repo,
    local_skill_roots,
)

BACKUP_ROOT = Path.home() / ".claude" / "skills-sync-backups"


def is_ignored(rel: Path) -> bool:
    if any(part in IGNORE_DIR_NAMES for part in rel.parts):
        return True
    return rel.name in IGNORE_FILE_NAMES or rel.suffix in IGNORE_SUFFIXES


def tree_files(root: Path) -> set[Path]:
    if not root.is_dir():
        return set()
    return {
        p.relative_to(root)
        for p in root.rglob("*")
        if p.is_file() and not p.is_symlink() and not is_ignored(p.relative_to(root))
    }


def backup(dest: Path, tag: str, dry_run: bool) -> Path | None:
    if not dest.exists():
        return None
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    target = BACKUP_ROOT / f"{stamp}-{tag}" / dest.name
    if dry_run:
        return target
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(dest, target, dirs_exist_ok=True)
    return target


def mirror(src: Path, dest: Path, dry_run: bool) -> tuple[list[str], list[str]]:
    """Zkopíruje src → dest a smaže v dest soubory navíc. Vrací (zapsané, smazané)."""
    src_files, dest_files = tree_files(src), tree_files(dest)
    written, removed = [], []

    for rel in sorted(src_files):
        s, d = src / rel, dest / rel
        if d.is_file() and s.read_bytes() == d.read_bytes():
            continue
        written.append(str(rel))
        if not dry_run:
            d.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(s, d)

    for rel in sorted(dest_files - src_files):
        removed.append(str(rel))
        if not dry_run:
            (dest / rel).unlink()

    if not dry_run:
        # uklidit prázdné adresáře, které po mazání zbyly
        for d in sorted((p for p in dest.rglob("*") if p.is_dir()), key=lambda p: -len(p.parts)):
            if not any(d.iterdir()):
                d.rmdir()
    return written, removed


def pick_local_target(name: str, explicit_root: str | None) -> Path:
    """Kam zapsat lokální kopii skillu."""
    roots = local_skill_roots()
    for root in roots:
        if name in collect_skills(root):
            return root / name  # už existuje – přepiš na místě
    if explicit_root:
        return Path(explicit_root).expanduser() / name
    # nový skill: raději do neřízeného ~/.claude/skills než do synced/
    unmanaged = Path.home() / ".claude" / "skills"
    unmanaged.mkdir(parents=True, exist_ok=True)
    return unmanaged / name


def main() -> int:
    ap = argparse.ArgumentParser(description="Aplikuje jednu sync akci na jeden skill.")
    ap.add_argument("--skill", required=True, help="jméno skillu (název složky)")
    ap.add_argument(
        "--direction",
        required=True,
        choices=["local-to-repo", "repo-to-local", "delete-repo", "delete-local"],
    )
    ap.add_argument("--repo", help="cesta ke klonu repozitáře")
    ap.add_argument("--slug", default=DEFAULT_REPO_SLUG)
    ap.add_argument("--local-root", help="kořen pro nové lokální skilly")
    ap.add_argument("--dry-run", action="store_true", help="jen vypíše, co by udělal")
    ap.add_argument("--no-backup", action="store_true", help="nezálohovat cíl")
    args = ap.parse_args()

    repo_root = find_repo(args.repo, args.slug)
    if not repo_root:
        print(f"CHYBA: klon repozitáře {args.slug} nenalezen.", file=sys.stderr)
        return 3

    repo_path = repo_root / REPO_SKILLS_SUBDIR / args.skill
    local_path = None
    for root in local_skill_roots():
        if args.skill in collect_skills(root):
            local_path = root / args.skill
            break

    prefix = "[dry-run] " if args.dry_run else ""

    if args.direction == "local-to-repo":
        if not local_path:
            print(f"CHYBA: skill '{args.skill}' lokálně neexistuje.", file=sys.stderr)
            return 2
        if not args.no_backup:
            b = backup(repo_path, f"repo-{args.skill}", args.dry_run)
            if b:
                print(f"{prefix}záloha repo verze → {b}")
        if not args.dry_run:
            repo_path.mkdir(parents=True, exist_ok=True)
        written, removed = mirror(local_path, repo_path, args.dry_run)
        print(f"{prefix}{local_path} → {repo_path}")

    elif args.direction == "repo-to-local":
        if not repo_path.is_dir():
            print(f"CHYBA: skill '{args.skill}' v repu neexistuje.", file=sys.stderr)
            return 2
        dest = local_path or pick_local_target(args.skill, args.local_root)
        if not args.no_backup:
            b = backup(dest, f"local-{args.skill}", args.dry_run)
            if b:
                print(f"{prefix}záloha lokální verze → {b}")
        if not args.dry_run:
            dest.mkdir(parents=True, exist_ok=True)
        written, removed = mirror(repo_path, dest, args.dry_run)
        print(f"{prefix}{repo_path} → {dest}")
        if "synced" in dest.parts:
            print(
                "POZOR: zapsáno do řízené složky 'synced/'. Tuto změnu může přepsat "
                "další sync z claude.ai — uprav skill i v nastavení na claude.ai."
            )

    elif args.direction == "delete-repo":
        if not repo_path.is_dir():
            print(f"'{args.skill}' v repu není, nic k mazání.")
            return 0
        if not args.no_backup:
            b = backup(repo_path, f"repo-{args.skill}", args.dry_run)
            print(f"{prefix}záloha → {b}")
        if not args.dry_run:
            shutil.rmtree(repo_path)
        written, removed = [], ["<celá složka>"]
        print(f"{prefix}smazáno {repo_path}")

    else:  # delete-local
        if not local_path:
            print(f"'{args.skill}' lokálně není, nic k mazání.")
            return 0
        if not args.no_backup:
            b = backup(local_path, f"local-{args.skill}", args.dry_run)
            print(f"{prefix}záloha → {b}")
        if not args.dry_run:
            shutil.rmtree(local_path)
        written, removed = [], ["<celá složka>"]
        print(f"{prefix}smazáno {local_path}")

    for f in written:
        print(f"  + {f}")
    for f in removed:
        print(f"  - {f}")
    if not written and not removed:
        print("  (žádná změna – už bylo shodné)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
