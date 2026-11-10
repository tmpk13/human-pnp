"""Build tests/data/sample.kicad_pcb: a small two-sided board in the
current KiCad format, made from KiCad's stock footprint libraries.

It holds one or more of every part kind the viewer draws a symbol for,
values written in several notations (4k7 and 4.7k, 1uF next to 1uF 25V and
1uF 50V), a DNP part and parts on the back. The unit tests and the browser
checks load it.

Runs under the system python3 (KiCad's pcbnew bindings):
    python3 scripts/make_sample.py tests/data/sample.kicad_pcb
"""

import sys

import pcbnew

LIBS = "/usr/share/kicad/footprints"

# Board corner (mm) and size.
OX, OY, W, H = 100.0, 100.0, 60.0, 40.0

# ref, value, library:footprint, x, y (relative to the board corner),
# rotation (degrees), side, extra flags.
PARTS = [
    ("U1", "RP2040", "Package_DFN_QFN:QFN-56-1EP_7x7mm_P0.4mm_EP3.2x3.2mm", 30, 20, 0, "F", ""),
    ("U2", "AP2112K-3.3", "Package_TO_SOT_SMD:SOT-23-5", 14, 9, 90, "F", ""),
    ("U3", "W25Q16JVSS", "Package_SO:SOIC-8_3.9x4.9mm_P1.27mm", 44, 20, 270, "F", ""),
    ("C1", "100nF", "Capacitor_SMD:C_0402_1005Metric", 25, 14, 0, "F", ""),
    ("C2", "100nF", "Capacitor_SMD:C_0402_1005Metric", 35, 14, 180, "F", ""),
    ("C3", "100nF", "Capacitor_SMD:C_0402_1005Metric", 25, 26, 0, "F", ""),
    ("C4", "100n", "Capacitor_SMD:C_0402_1005Metric", 35, 26, 180, "F", ""),
    ("C5", "0.1uF", "Capacitor_SMD:C_0402_1005Metric", 23.5, 20, 90, "F", ""),
    ("C6", "100nF", "Capacitor_SMD:C_0402_1005Metric", 36.5, 20, 270, "F", ""),
    ("C7", "1uF", "Capacitor_SMD:C_0402_1005Metric", 11, 12, 90, "F", ""),
    ("C8", "1uF", "Capacitor_SMD:C_0402_1005Metric", 17, 12, 90, "F", ""),
    ("C9", "1uF 25V", "Capacitor_SMD:C_0603_1608Metric", 11, 6, 0, "F", ""),
    ("C10", "1uF 25V", "Capacitor_SMD:C_0603_1608Metric", 17, 6, 0, "F", ""),
    ("C11", "1uF 50V", "Capacitor_SMD:C_0603_1608Metric", 21, 6, 0, "F", ""),
    ("C12", "10uF 10V X5R", "Capacitor_SMD:C_0805_2012Metric", 7, 16, 90, "F", ""),
    ("C13", "47uF", "Capacitor_SMD:CP_Elec_5x5.4", 7, 30, 0, "F", ""),
    ("C14", "12pF", "Capacitor_SMD:C_0402_1005Metric", 46, 31, 90, "F", ""),
    ("C15", "12pF", "Capacitor_SMD:C_0402_1005Metric", 52, 31, 90, "F", ""),
    ("R1", "10k", "Resistor_SMD:R_0402_1005Metric", 40, 8, 0, "F", ""),
    ("R2", "10k", "Resistor_SMD:R_0402_1005Metric", 40, 10, 0, "F", ""),
    ("R3", "10K", "Resistor_SMD:R_0402_1005Metric", 40, 12, 0, "F", ""),
    ("R4", "27R", "Resistor_SMD:R_0402_1005Metric", 22, 33, 90, "F", ""),
    ("R5", "27R", "Resistor_SMD:R_0402_1005Metric", 24, 33, 90, "F", ""),
    ("R6", "5k1", "Resistor_SMD:R_0402_1005Metric", 15, 33, 90, "F", ""),
    ("R7", "5.1k", "Resistor_SMD:R_0402_1005Metric", 17, 33, 90, "F", ""),
    ("R8", "1k", "Resistor_SMD:R_0402_1005Metric", 52, 8, 0, "F", ""),
    ("R9", "4k7", "Resistor_SMD:R_0603_1608Metric", 48, 12, 0, "F", ""),
    ("R10", "4.7k", "Resistor_SMD:R_0603_1608Metric", 52, 12, 0, "F", ""),
    ("R11", "10k", "Resistor_SMD:R_0402_1005Metric", 40, 14, 0, "F", "dnp"),
    ("D1", "Green", "LED_SMD:LED_0603_1608Metric", 56, 8, 180, "F", ""),
    ("D2", "Red", "LED_SMD:LED_0603_1608Metric", 56, 12, 180, "F", ""),
    ("D3", "1N4148W", "Diode_SMD:D_SOD-123", 14, 20, 90, "F", ""),
    ("D4", "B5819W", "Diode_SMD:D_SOD-123", 18, 20, 270, "F", ""),
    ("Q1", "2N7002", "Package_TO_SOT_SMD:SOT-23", 50, 25, 0, "F", ""),
    ("Q2", "MMBT3904", "Package_TO_SOT_SMD:SOT-23", 55, 25, 90, "F", ""),
    ("L1", "2.2uH", "Inductor_SMD:L_0805_2012Metric", 7, 22, 90, "F", ""),
    ("FB1", "600R@100MHz", "Inductor_SMD:L_0603_1608Metric", 11, 22, 90, "F", ""),
    ("Y1", "12MHz", "Crystal:Crystal_SMD_3225-4Pin_3.2x2.5mm", 49, 31, 0, "F", ""),
    ("SW1", "BOOT", "Button_Switch_SMD:SW_Push_1P1T_NO_CK_KMR2", 40, 33, 0, "F", ""),
    ("J1", "USB_C_Receptacle", "Connector_USB:USB_C_Receptacle_GCT_USB4105-xx-A_16P_TopMnt_Horizontal", 20, 38, 0, "F", ""),
    ("J2", "Conn_01x04", "Connector_PinHeader_2.54mm:PinHeader_1x04_P2.54mm_Vertical", 57, 15, 0, "F", ""),
    ("J3", "Battery", "Connector_JST:JST_PH_S2B-PH-K_1x02_P2.00mm_Horizontal", 31, 5, 180, "F", ""),
    ("F1", "500mA", "Fuse:Fuse_1206_3216Metric", 27, 33, 90, "F", ""),
    ("TP1", "TP", "TestPoint:TestPoint_Pad_D1.0mm", 44, 37, 0, "F", ""),
    ("H1", "MountingHole", "MountingHole:MountingHole_2.7mm_M2.5", 3.5, 3.5, 0, "F", ""),
    ("H2", "MountingHole", "MountingHole:MountingHole_2.7mm_M2.5", 56.5, 3.5, 0, "F", ""),
    ("H3", "MountingHole", "MountingHole:MountingHole_2.7mm_M2.5", 3.5, 36.5, 0, "F", ""),
    ("H4", "MountingHole", "MountingHole:MountingHole_2.7mm_M2.5", 56.5, 36.5, 0, "F", ""),
    ("FID1", "Fiducial", "Fiducial:Fiducial_1mm_Mask2mm", 8, 3, 0, "F", ""),
    ("FID2", "Fiducial", "Fiducial:Fiducial_1mm_Mask2mm", 52, 37, 0, "F", ""),
    ("U4", "USBLC6-2SC6", "Package_TO_SOT_SMD:SOT-23-6", 20, 28, 0, "B", ""),
    ("C20", "100nF", "Capacitor_SMD:C_0402_1005Metric", 30, 12, 0, "B", ""),
    ("C21", "100nF", "Capacitor_SMD:C_0402_1005Metric", 30, 28, 0, "B", ""),
    ("C22", "1uF", "Capacitor_SMD:C_0603_1608Metric", 36, 30, 90, "B", ""),
    ("R20", "10k", "Resistor_SMD:R_0402_1005Metric", 44, 28, 90, "B", ""),
    ("R21", "10k", "Resistor_SMD:R_0402_1005Metric", 46, 28, 90, "B", ""),
]


def v(x, y):
    return pcbnew.VECTOR2I(pcbnew.FromMM(OX + x), pcbnew.FromMM(OY + y))


def edge_segment(board, x0, y0, x1, y1):
    s = pcbnew.PCB_SHAPE(board)
    s.SetShape(pcbnew.SHAPE_T_SEGMENT)
    s.SetStart(v(x0, y0))
    s.SetEnd(v(x1, y1))
    s.SetLayer(pcbnew.Edge_Cuts)
    s.SetWidth(pcbnew.FromMM(0.1))
    board.Add(s)


def edge_arc(board, sx, sy, mx, my, ex, ey):
    s = pcbnew.PCB_SHAPE(board)
    s.SetShape(pcbnew.SHAPE_T_ARC)
    s.SetArcGeometry(v(sx, sy), v(mx, my), v(ex, ey))
    s.SetLayer(pcbnew.Edge_Cuts)
    s.SetWidth(pcbnew.FromMM(0.1))
    board.Add(s)


def main():
    out = sys.argv[1]
    board = pcbnew.BOARD()
    board.GetTitleBlock().SetTitle("human-pnp sample")

    # Rounded rectangle outline, corner radius r.
    r = 2.0
    k = r * (1 - 0.5 ** 0.5)  # inset of an arc's midpoint at 45 degrees
    edge_segment(board, r, 0, W - r, 0)
    edge_arc(board, W - r, 0, W - k, k, W, r)
    edge_segment(board, W, r, W, H - r)
    edge_arc(board, W, H - r, W - k, H - k, W - r, H)
    edge_segment(board, W - r, H, r, H)
    edge_arc(board, r, H, k, H - k, 0, H - r)
    edge_segment(board, 0, H - r, 0, r)
    edge_arc(board, 0, r, k, k, r, 0)

    for ref, value, fpid, x, y, rot, side, flags in PARTS:
        lib, name = fpid.split(":")
        fp = pcbnew.FootprintLoad(f"{LIBS}/{lib}.pretty", name)
        if fp is None:
            raise SystemExit(f"footprint {fpid} not found")
        fp.SetFPID(pcbnew.LIB_ID(lib, name))
        fp.SetReference(ref)
        fp.SetValue(value)
        # Flip reads the board's layer stack, so the footprint must be on
        # the board first (pcbnew segfaults otherwise).
        board.Add(fp)
        fp.SetPosition(v(x, y))
        if side == "B":
            fp.Flip(fp.GetPosition(), pcbnew.FLIP_DIRECTION_TOP_BOTTOM)
        fp.SetOrientationDegrees(rot)
        if "dnp" in flags:
            fp.SetDNP(True)

    pcbnew.SaveBoard(out, board)


if __name__ == "__main__":
    main()
