#!/usr/bin/env python3
import argparse
import calendar
import json
import os
import re
import sys
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path
from typing import Optional


NS = {
    "main": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    "rel": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
}

STAFF_SHEET_NAME = "2026.04 직원 근무표"
SHOCKWAVE_SHEET_NAME = "2026.04 충격파."
SHOCKWAVE_YELLOW = "#ffe599"


def parse_env(env_path: Path) -> dict:
    values = {}
    for line in env_path.read_text(encoding="utf-8").splitlines():
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key] = value
    return values


def download_xlsx(sheet_url: str, output_path: Path) -> Path:
    spreadsheet_id = re.search(r"/spreadsheets/d/([a-zA-Z0-9-_]+)", sheet_url)
    if not spreadsheet_id:
      raise ValueError("Invalid Google Sheets URL")
    export_url = f"https://docs.google.com/spreadsheets/d/{spreadsheet_id.group(1)}/export?format=xlsx"
    req = urllib.request.Request(
        export_url,
        headers={
            "User-Agent": "Mozilla/5.0",
        },
    )
    with urllib.request.urlopen(req, timeout=60) as response:
        output_path.write_bytes(response.read())
    return output_path


def get_column_letters(index_1_based: int) -> str:
    letters = []
    n = index_1_based
    while n:
        n, rem = divmod(n - 1, 26)
        letters.append(chr(65 + rem))
    return "".join(reversed(letters))


def normalize_rgb(rgb: Optional[str]) -> Optional[str]:
    if not rgb:
        return None
    rgb = rgb.upper()
    if len(rgb) == 8:
        rgb = rgb[-6:]
    if len(rgb) != 6:
        return None
    return f"#{rgb.lower()}"


class WorkbookParser:
    def __init__(self, xlsx_path: Path):
        self.xlsx_path = xlsx_path
        self.shared_strings = []
        self.style_fill_map = []
        self.fill_colors = []
        self.sheet_paths = {}
        self._load()

    def _load(self):
        with zipfile.ZipFile(self.xlsx_path) as zf:
            self._load_shared_strings(zf)
            self._load_styles(zf)
            self._load_sheet_paths(zf)

    def _load_shared_strings(self, zf: zipfile.ZipFile):
        if "xl/sharedStrings.xml" not in zf.namelist():
            return
        root = ET.fromstring(zf.read("xl/sharedStrings.xml"))
        for si in root.findall("main:si", NS):
            text = "".join(node.text or "" for node in si.iter(f"{{{NS['main']}}}t"))
            self.shared_strings.append(text)

    def _load_styles(self, zf: zipfile.ZipFile):
        root = ET.fromstring(zf.read("xl/styles.xml"))
        fills = root.find("main:fills", NS)
        for fill in fills.findall("main:fill", NS):
            pattern = fill.find("main:patternFill", NS)
            fg = pattern.find("main:fgColor", NS) if pattern is not None else None
            self.fill_colors.append(normalize_rgb(fg.attrib.get("rgb")) if fg is not None else None)
        cell_xfs = root.find("main:cellXfs", NS)
        self.style_fill_map = [int(xf.attrib.get("fillId", "0")) for xf in cell_xfs.findall("main:xf", NS)]

    def _load_sheet_paths(self, zf: zipfile.ZipFile):
        workbook = ET.fromstring(zf.read("xl/workbook.xml"))
        rels = ET.fromstring(zf.read("xl/_rels/workbook.xml.rels"))
        rel_map = {rel.attrib["Id"]: "xl/" + rel.attrib["Target"] for rel in rels}
        sheets = workbook.find("main:sheets", NS)
        for sheet in sheets.findall("main:sheet", NS):
            rel_id = sheet.attrib[f"{{{NS['rel']}}}id"]
            self.sheet_paths[sheet.attrib["name"]] = rel_map[rel_id]

    def parse_sheet(self, name: str) -> dict[int, dict[str, dict]]:
        with zipfile.ZipFile(self.xlsx_path) as zf:
            root = ET.fromstring(zf.read(self.sheet_paths[name]))
        sheet_data = root.find("main:sheetData", NS)
        rows = {}
        for row in sheet_data.findall("main:row", NS):
            row_num = int(row.attrib["r"])
            row_cells = {}
            for cell in row.findall("main:c", NS):
                ref = cell.attrib["r"]
                match = re.match(r"([A-Z]+)(\d+)$", ref)
                if not match:
                    continue
                col = match.group(1)
                style_index = int(cell.attrib.get("s", "0"))
                fill_id = self.style_fill_map[style_index] if style_index < len(self.style_fill_map) else 0
                fill_color = self.fill_colors[fill_id] if fill_id < len(self.fill_colors) else None
                row_cells[col] = {
                    "value": self._cell_value(cell),
                    "bg_color": fill_color,
                }
            rows[row_num] = row_cells
        return rows

    def _cell_value(self, cell) -> str:
        cell_type = cell.attrib.get("t")
        if cell_type == "inlineStr":
            return "".join(node.text or "" for node in cell.iter(f"{{{NS['main']}}}t"))
        value_node = cell.find("main:v", NS)
        if value_node is None or value_node.text is None:
            return ""
        if cell_type == "s":
            return self.shared_strings[int(value_node.text)]
        return value_node.text


def build_staff_rows(sheet_rows: dict[int, dict[str, dict]], year: int, month: int) -> list[dict]:
    weeks = calendar.Calendar(firstweekday=6).monthdatescalendar(year, month)
    import_rows = []
    for week_index, week_dates in enumerate(weeks):
        date_row = 4 + week_index * 7
        for slot_index in range(6):
            row_cells = sheet_rows.get(date_row + 1 + slot_index, {})
            for day_offset, actual_date in enumerate(week_dates):
                if actual_date.month != month:
                    continue
                column = get_column_letters(2 + day_offset)
                content = (row_cells.get(column, {}).get("value") or "").strip()
                if not content:
                    continue
                import_rows.append({
                    "year": year,
                    "month": month,
                    "day": actual_date.day,
                    "slot_index": slot_index,
                    "content": content,
                    "font_color": None,
                })
    return import_rows


def build_shockwave_rows(sheet_rows: dict[int, dict[str, dict]], year: int, month: int) -> list[dict]:
    import_rows = []
    week_index = -1
    row_index = None
    for row_num in sorted(sheet_rows):
        cells = sheet_rows[row_num]
        first_col_value = (cells.get("A", {}).get("value") or "").strip()
        if re.fullmatch(r"\d+주차", first_col_value):
            week_index += 1
            row_index = None
            continue
        if week_index < 0:
            continue
        if (cells.get("B", {}).get("value") or "").strip() == "주한솔":
            row_index = 0
            continue
        if row_index is None or not first_col_value:
            continue
        for day_index in range(6):
            for col_index in range(3):
                column = get_column_letters(2 + day_index * 3 + col_index)
                cell = cells.get(column)
                if not cell:
                    continue
                content = (cell.get("value") or "").strip()
                if not content:
                    continue
                bg_color = SHOCKWAVE_YELLOW if cell.get("bg_color") == SHOCKWAVE_YELLOW else None
                import_rows.append({
                    "year": year,
                    "month": month,
                    "week_index": week_index,
                    "day_index": day_index,
                    "row_index": row_index,
                    "col_index": col_index,
                    "content": content,
                    "bg_color": bg_color,
                })
        row_index += 1
    return import_rows


def supabase_request(base_url: str, api_key: str, method: str, table: str, params: Optional[dict] = None, payload=None):
    query = urllib.parse.urlencode(params or {}, doseq=True)
    url = f"{base_url}/rest/v1/{table}"
    if query:
        url += f"?{query}"
    data = None
    headers = {
        "apikey": api_key,
        "Authorization": f"Bearer {api_key}",
    }
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"
        headers["Prefer"] = "return=minimal"
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    with urllib.request.urlopen(req, timeout=60) as response:
        return response.status, response.read().decode("utf-8")


def delete_month_data(base_url: str, api_key: str, table: str, year: int, month: int):
    return supabase_request(
        base_url,
        api_key,
        "DELETE",
        table,
        params={"year": f"eq.{year}", "month": f"eq.{month}"},
    )


def insert_rows(base_url: str, api_key: str, table: str, rows: list[dict]):
    if not rows:
        return 200, ""
    return supabase_request(base_url, api_key, "POST", table, payload=rows)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--sheet-url", required=True)
    parser.add_argument("--xlsx-path", default="/tmp/google_sheet_import.xlsx")
    parser.add_argument("--year", type=int, default=2026)
    parser.add_argument("--month", type=int, default=4)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()

    project_root = Path(__file__).resolve().parent.parent
    env = parse_env(project_root / ".env")
    base_url = env["VITE_SUPABASE_URL"]
    api_key = env["VITE_SUPABASE_KEY"]

    xlsx_path = Path(args.xlsx_path)
    download_xlsx(args.sheet_url, xlsx_path)
    workbook = WorkbookParser(xlsx_path)

    staff_sheet = workbook.parse_sheet(STAFF_SHEET_NAME)
    shockwave_sheet = workbook.parse_sheet(SHOCKWAVE_SHEET_NAME)
    staff_rows = build_staff_rows(staff_sheet, args.year, args.month)
    shockwave_rows = build_shockwave_rows(shockwave_sheet, args.year, args.month)

    print(json.dumps({
        "staff_count": len(staff_rows),
        "staff_sample": staff_rows[:10],
        "shockwave_count": len(shockwave_rows),
        "shockwave_yellow_count": sum(1 for row in shockwave_rows if row["bg_color"] == SHOCKWAVE_YELLOW),
        "shockwave_sample": shockwave_rows[:10],
    }, ensure_ascii=False, indent=2))

    if not args.apply:
        return

    delete_month_data(base_url, api_key, "staff_schedules", args.year, args.month)
    delete_month_data(base_url, api_key, "shockwave_schedules", args.year, args.month)
    insert_rows(base_url, api_key, "staff_schedules", staff_rows)
    insert_rows(base_url, api_key, "shockwave_schedules", shockwave_rows)
    print(json.dumps({
        "applied": True,
        "staff_inserted": len(staff_rows),
        "shockwave_inserted": len(shockwave_rows),
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise
