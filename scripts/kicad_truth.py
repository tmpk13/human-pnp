"""Dump what KiCad itself computes for a board, as JSON, for the parser tests.

Runs under the system python3 because it needs KiCad's pcbnew bindings,
which only ship with a KiCad install. KiCad 10 reads every older board
format, so its numbers are the reference for boards from KiCad 4 onward.

Usage: python3 scripts/kicad_truth.py <board.kicad_pcb> <out.json>

Coordinates are millimeters in KiCad's board frame (Y grows downward).
Angles are degrees, counterclockwise as seen from the front.
"""

import json
import sys

import pcbnew


def mm(v):
    return round(float(pcbnew.ToMM(v)), 6)  # type: ignore[arg-type]


def pad_size(pad):
    # KiCad 9+ pads carry a padstack; the front copper size is the one a
    # placement view draws.
    try:
        s = pad.GetSize(pcbnew.F_Cu)
    except TypeError:
        s = pad.GetSize()
    return mm(s.x), mm(s.y)


def shape_points(shape):
    """Start, end, and (for arcs) mid point plus circle data of an edge shape."""
    t = shape.GetShape()
    d = {"type": shape.ShowShape()}
    if t == pcbnew.SHAPE_T_CIRCLE:
        c = shape.GetCenter()
        d.update(cx=mm(c.x), cy=mm(c.y), r=mm(shape.GetRadius()))
    elif t == pcbnew.SHAPE_T_ARC:
        s, m, e = shape.GetStart(), shape.GetArcMid(), shape.GetEnd()
        d.update(sx=mm(s.x), sy=mm(s.y), mx=mm(m.x), my=mm(m.y), ex=mm(e.x), ey=mm(e.y))
    elif t in (pcbnew.SHAPE_T_SEGMENT, pcbnew.SHAPE_T_RECT):
        s, e = shape.GetStart(), shape.GetEnd()
        d.update(sx=mm(s.x), sy=mm(s.y), ex=mm(e.x), ey=mm(e.y))
    elif t == pcbnew.SHAPE_T_POLY:
        pts = []
        poly = shape.GetPolyShape()
        for i in range(poly.OutlineCount()):
            o = poly.Outline(i)
            for j in range(o.PointCount()):
                p = o.CPoint(j)
                pts.append([mm(p.x), mm(p.y)])
        d.update(points=pts)
    return d


def main():
    path, out = sys.argv[1], sys.argv[2]
    board = pcbnew.LoadBoard(path)
    footprints = []
    for fp in board.GetFootprints():
        pos = fp.GetPosition()
        pads = []
        for pad in fp.Pads():
            p = pad.GetPosition()
            w, h = pad_size(pad)
            pads.append({
                "num": pad.GetNumber(),
                "x": mm(p.x),
                "y": mm(p.y),
                "rot": round(pad.GetOrientationDegrees(), 4),
                "w": w,
                "h": h,
            })
        footprints.append({
            "ref": fp.GetReference(),
            "value": fp.GetValue(),
            "lib": str(fp.GetFPID().GetUniStringLibId()),
            "x": mm(pos.x),
            "y": mm(pos.y),
            "rot": round(fp.GetOrientationDegrees(), 4),
            "side": "B" if fp.IsFlipped() else "F",
            "dnp": bool(fp.IsDNP()),
            "noBom": bool(fp.IsExcludedFromBOM()),
            "boardOnly": bool(fp.IsBoardOnly()),
            "pads": pads,
        })
    drawings = list(board.GetDrawings())
    for fp in board.GetFootprints():
        drawings.extend(fp.GraphicalItems())
    edges = [shape_points(d) for d in drawings
             if d.GetLayer() == pcbnew.Edge_Cuts and isinstance(d, pcbnew.PCB_SHAPE)]
    with open(out, "w") as f:
        json.dump({"footprints": footprints, "edges": edges}, f, indent=1)


if __name__ == "__main__":
    main()
