import { useState, useRef, useEffect } from 'react';
import { Stage, Layer, Image as KonvaImage, Line, Circle, Text, Group, Transformer, Arc, Label, Tag, Arrow } from 'react-konva';
import useImage from 'use-image';
import { MousePointer2, Ruler, RotateCcw, Trash2, ArrowRight, MapPin } from 'lucide-react';
import Konva from 'konva';

// --- Constants ---
const FIELD_WIDTH = 2362;
const FIELD_HEIGHT = 1143;
const ROBOT_WIDTH = 208;
const ROBOT_HEIGHT = 215;
const ROBOT_PIVOT_X = 104;
const ROBOT_PIVOT_Y = 130; // 215 - 85 (85mm from bottom)
const ROBOT_SNAP_DISTANCE = 5;
const MEASURE_SNAP_DISTANCE = 10;

// --- Types ---
type Mode = 'select' | 'measure' | 'arrow' | 'action_node' | 'annotation';

type MeasurementLine = {
  id: string;
  points: [number, number, number, number];
};

type ArrowLine = {
  id: string;
  points: [number, number, number, number];
  color: string;
};

type ActionType = 'turn' | 'open_clamp' | 'close_clamp' | 'lift_fork' | 'lower_fork' | 'custom';

type ActionNode = {
  id: string;
  x: number;
  y: number;
  actionType: ActionType;
  degrees?: number;
  customText?: string;
  isExpanded: boolean;
};

type Annotation = {
  id: string;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  text: string;
  isExpanded: boolean;
};

type RobotState = {
  x: number;
  y: number;
  rotation: number;
};

type Modifiers = {
  shift: boolean;
  ctrl: boolean;
};

type ContextMenuState = {
  visible: boolean;
  x: number;
  y: number;
  type: 'arrow' | 'action_node';
  targetId: string;
};

type AnnotationModalState = {
  visible: boolean;
  isEdit: boolean;
  id?: string;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  text: string;
};

// --- Color Palette (16 Colors) ---
const COLOR_PALETTE = [
  '#ef4444', '#f97316', '#f59e0b', '#eab308', // Red, Orange, Amber, Yellow
  '#84cc16', '#22c55e', '#10b981', '#06b6d4', // Lime, Green, Emerald, Cyan
  '#0ea5e9', '#3b82f6', '#6366f1', '#8b5cf6', // Sky, Blue, Indigo, Violet
  '#a855f7', '#d946ef', '#ec4899', '#64748b', // Purple, Fuchsia, Pink, Slate
];

// --- Helper Functions ---
const getDistance = (x1: number, y1: number, x2: number, y2: number) => {
  return Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
};

// Get the rotated corners of the robot in world coordinates
const getRobotCorners = (state: RobotState) => {
  const rad = (state.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  const dx1 = -ROBOT_PIVOT_X;
  const dy1 = -ROBOT_PIVOT_Y;
  const dx2 = ROBOT_WIDTH - ROBOT_PIVOT_X;
  const dy2 = ROBOT_HEIGHT - ROBOT_PIVOT_Y;

  const localCorners = [
    { x: dx1, y: dy1 }, // Top-Left
    { x: dx2, y: dy1 }, // Top-Right
    { x: dx2, y: dy2 }, // Bottom-Right
    { x: dx1, y: dy2 }, // Bottom-Left
  ];

  return localCorners.map(p => ({
    x: state.x + p.x * cos - p.y * sin,
    y: state.y + p.x * sin + p.y * cos,
  }));
};

// Project point (px, py) onto line segment AB
const getClosestPointOnSegment = (px: number, py: number, ax: number, ay: number, bx: number, by: number) => {
  const abx = bx - ax;
  const aby = by - ay;
  const apx = px - ax;
  const apy = py - ay;

  const abLenSq = abx * abx + aby * aby;
  if (abLenSq === 0) return { x: ax, y: ay };

  let t = (apx * abx + apy * aby) / abLenSq;
  t = Math.max(0, Math.min(1, t)); // clamp to segment

  return {
    x: ax + t * abx,
    y: ay + t * aby,
  };
};

export default function App() {
  const [mode, setMode] = useState<Mode>('select');
  const [lines, setLines] = useState<MeasurementLine[]>([]);
  const [arrows, setArrows] = useState<ArrowLine[]>([]);
  const [actionNodes, setActionNodes] = useState<ActionNode[]>([]);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);

  // Selection state
  const [activeLineId, setActiveLineId] = useState<string | null>(null);
  const [activeArrowId, setActiveArrowId] = useState<string | null>(null);
  const [activeActionNodeId, setActiveActionNodeId] = useState<string | null>(null);
  const [activeAnnotationId, setActiveAnnotationId] = useState<string | null>(null);
  const [isRobotSelected, setIsRobotSelected] = useState<boolean>(false);

  const [isRotating, setIsRotating] = useState<boolean>(false);
  const [initialRotation, setInitialRotation] = useState<number>(0);
  const [drawingLine, setDrawingLine] = useState<[number, number, number, number] | null>(null);
  
  const [robotState, setRobotState] = useState<RobotState>({
    x: FIELD_WIDTH / 2,
    y: FIELD_HEIGHT / 2,
    rotation: 0,
  });

  // Context Menu & Modals
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [annotationModal, setAnnotationModal] = useState<AnnotationModalState | null>(null);
  
  const modifiersRef = useRef<Modifiers>({ shift: false, ctrl: false });
  
  const [stageScale, setStageScale] = useState(1);
  const [stagePos, setStagePos] = useState({ x: 0, y: 0 });
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  // Images
  const [bgImage] = useImage('./imgs/field_optimized.webp');
  const [robotImage] = useImage('./imgs/國小組比賽機V1_20260504.png');

  // Refs
  const stageRef = useRef<Konva.Stage>(null);
  const robotRef = useRef<Konva.Group>(null);
  const trRef = useRef<Konva.Transformer>(null);

  // Initialize stage scale to fit screen
  useEffect(() => {
    const container = document.querySelector('.canvas-container');
    if (container) {
      const scale = Math.min(
        container.clientWidth / (FIELD_WIDTH + 60),
        container.clientHeight / (FIELD_HEIGHT + 60)
      );
      setStageScale(scale);
      setStagePos({
        x: (container.clientWidth - FIELD_WIDTH * scale) / 2,
        y: (container.clientHeight - FIELD_HEIGHT * scale) / 2,
      });
    }
  }, []);

  // Handle Key Events for Modifiers
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const shift = e.key === 'Shift' ? true : modifiersRef.current.shift;
      const ctrl = (e.key === 'Control' || e.key === 'Meta') ? true : modifiersRef.current.ctrl;
      modifiersRef.current = { shift, ctrl };
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      const shift = e.key === 'Shift' ? false : modifiersRef.current.shift;
      const ctrl = (e.key === 'Control' || e.key === 'Meta') ? false : modifiersRef.current.ctrl;
      modifiersRef.current = { shift, ctrl };
    };
    
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  // Handle Zoom
  const handleWheel = (e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const stage = stageRef.current;
    if (!stage) return;

    const scaleBy = 1.1;
    const oldScale = stage.scaleX();
    const pointer = stage.getPointerPosition();
    if (!pointer) return;

    const mousePointTo = {
      x: (pointer.x - stage.x()) / oldScale,
      y: (pointer.y - stage.y()) / oldScale,
    };

    let newScale = e.evt.deltaY > 0 ? oldScale / scaleBy : oldScale * scaleBy;
    newScale = Math.max(0.1, Math.min(newScale, 5));

    setStageScale(newScale);
    setStagePos({
      x: pointer.x - mousePointTo.x * newScale,
      y: pointer.y - mousePointTo.y * newScale,
    });
  };

  const getRelativePointerPosition = () => {
    const stage = stageRef.current;
    if (!stage) return null;
    const transform = stage.getAbsoluteTransform().copy();
    transform.invert();
    const pos = stage.getPointerPosition();
    if (!pos) return null;
    return transform.point(pos);
  };

  // Snapping Logic for Tools (Edges, Corners, Center)
  const getSnappedPoint = (rawX: number, rawY: number) => {
    const x = Math.max(0, Math.min(rawX, FIELD_WIDTH));
    const y = Math.max(0, Math.min(rawY, FIELD_HEIGHT));

    let snappedX = x;
    let snappedY = y;
    let minSnapDist = MEASURE_SNAP_DISTANCE;

    // 1. Snap to Field Edges
    if (Math.abs(x - 0) < minSnapDist) {
      snappedX = 0;
      minSnapDist = Math.abs(x - 0);
    }
    if (Math.abs(x - FIELD_WIDTH) < minSnapDist) {
      snappedX = FIELD_WIDTH;
      minSnapDist = Math.abs(x - FIELD_WIDTH);
    }
    if (Math.abs(y - 0) < minSnapDist) {
      snappedY = 0;
      minSnapDist = Math.abs(y - 0);
    }
    if (Math.abs(y - FIELD_HEIGHT) < minSnapDist) {
      snappedY = FIELD_HEIGHT;
      minSnapDist = Math.abs(y - FIELD_HEIGHT);
    }

    // 2. Snap to Robot Center
    const distToCenter = getDistance(x, y, robotState.x, robotState.y);
    if (distToCenter < minSnapDist) {
      snappedX = robotState.x;
      snappedY = robotState.y;
      minSnapDist = distToCenter;
    }

    // 3. Snap to Robot Rotated Bounding Box Corners & Edges
    const corners = getRobotCorners(robotState);
    
    // Check corners
    for (const c of corners) {
      const d = getDistance(x, y, c.x, c.y);
      if (d < minSnapDist) {
        snappedX = c.x;
        snappedY = c.y;
        minSnapDist = d;
      }
    }

    // Check edges
    for (let i = 0; i < 4; i++) {
      const p1 = corners[i];
      const p2 = corners[(i + 1) % 4];
      const closest = getClosestPointOnSegment(x, y, p1.x, p1.y, p2.x, p2.y);
      const d = getDistance(x, y, closest.x, closest.y);
      if (d < minSnapDist) {
        snappedX = closest.x;
        snappedY = closest.y;
        minSnapDist = d;
      }
    }

    return { x: snappedX, y: snappedY };
  };

  const applyAngleSnapping = (startX: number, startY: number, endX: number, endY: number) => {
    if (!modifiersRef.current.shift) {
      return { 
        x: Math.max(0, Math.min(endX, FIELD_WIDTH)), 
        y: Math.max(0, Math.min(endY, FIELD_HEIGHT)) 
      };
    }
    const dx = endX - startX;
    const dy = endY - startY;
    const angle = Math.atan2(dy, dx);
    const snappedAngle = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
    const dist = Math.sqrt(dx * dx + dy * dy);
    
    let maxDist = Infinity;
    const cosA = Math.cos(snappedAngle);
    const sinA = Math.sin(snappedAngle);

    if (cosA > 1e-5) {
      maxDist = Math.min(maxDist, (FIELD_WIDTH - startX) / cosA);
    } else if (cosA < -1e-5) {
      maxDist = Math.min(maxDist, (0 - startX) / cosA);
    }

    if (sinA > 1e-5) {
      maxDist = Math.min(maxDist, (FIELD_HEIGHT - startY) / sinA);
    } else if (sinA < -1e-5) {
      maxDist = Math.min(maxDist, (0 - startY) / sinA);
    }

    const finalDist = Math.min(dist, maxDist);

    return {
      x: startX + cosA * finalDist,
      y: startY + sinA * finalDist,
    };
  };

  const handleStageMouseDown = (e: Konva.KonvaEventObject<MouseEvent>) => {
    // Deselect if clicking on empty stage or background image
    if (e.target === stageRef.current || e.target.name() === 'bg-image') {
      setActiveLineId(null);
      setActiveArrowId(null);
      setActiveActionNodeId(null);
      setActiveAnnotationId(null);
      setIsRobotSelected(false);
      setContextMenu(null);
    }

    const pos = getRelativePointerPosition();
    if (!pos) return;

    if (mode === 'measure') {
      const snapped = getSnappedPoint(pos.x, pos.y);
      if (!drawingLine) {
        setDrawingLine([snapped.x, snapped.y, snapped.x, snapped.y]);
      } else {
        const finalPoint = applyAngleSnapping(drawingLine[0], drawingLine[1], snapped.x, snapped.y);
        const newLine = {
          id: Date.now().toString(),
          points: [drawingLine[0], drawingLine[1], finalPoint.x, finalPoint.y] as [number, number, number, number],
        };
        setLines([...lines, newLine]);
        setDrawingLine(null);
        setActiveLineId(newLine.id);
        setMode('select'); // Switch back to select
      }
    } else if (mode === 'arrow') {
      const snapped = getSnappedPoint(pos.x, pos.y);
      if (!drawingLine) {
        setDrawingLine([snapped.x, snapped.y, snapped.x, snapped.y]);
      } else {
        const finalPoint = applyAngleSnapping(drawingLine[0], drawingLine[1], snapped.x, snapped.y);
        const newArrow = {
          id: Date.now().toString(),
          points: [drawingLine[0], drawingLine[1], finalPoint.x, finalPoint.y] as [number, number, number, number],
          color: '#2563eb', // Default blue
        };
        setArrows([...arrows, newArrow]);
        setDrawingLine(null);
        setActiveArrowId(newArrow.id);
        setMode('select');
      }
    } else if (mode === 'action_node') {
      const snapped = getSnappedPoint(pos.x, pos.y);
      const newNode: ActionNode = {
        id: Date.now().toString(),
        x: snapped.x,
        y: snapped.y,
        actionType: 'custom',
        customText: '自訂動作',
        isExpanded: true,
      };
      setActionNodes([...actionNodes, newNode]);
      setActiveActionNodeId(newNode.id);
      setMode('select');

      // Auto open action settings menu
      const stage = stageRef.current;
      if (stage) {
        const pointerPos = stage.getPointerPosition();
        if (pointerPos) {
          setContextMenu({
            visible: true,
            x: pointerPos.x,
            y: pointerPos.y,
            type: 'action_node',
            targetId: newNode.id,
          });
        }
      }
    } else if (mode === 'annotation') {
      const snapped = getSnappedPoint(pos.x, pos.y);
      const stage = stageRef.current;
      if (stage) {
        const pointerPos = stage.getPointerPosition();
        if (pointerPos) {
          setAnnotationModal({
            visible: true,
            isEdit: false,
            x: Math.max(20, snapped.x - 70), // offset initial dialog box
            y: Math.max(20, snapped.y - 120),
            targetX: snapped.x,
            targetY: snapped.y,
            text: '',
          });
        }
      }
    }
  };

  const handleStageMouseMove = () => {
    const pos = getRelativePointerPosition();
    if (!pos) return;
    setMousePos(pos);

    if ((mode === 'measure' || mode === 'arrow') && drawingLine) {
      const snapped = getSnappedPoint(pos.x, pos.y);
      const finalPoint = applyAngleSnapping(drawingLine[0], drawingLine[1], snapped.x, snapped.y);
      setDrawingLine([drawingLine[0], drawingLine[1], finalPoint.x, finalPoint.y]);
    }
  };

  // Robot Collision and Snapping
  const constrainRobotPosition = (node: Konva.Node) => {
    let { x, y } = node.position();
    const rect = node.getClientRect({ skipTransform: false, skipShadow: true });
    const stage = stageRef.current;
    
    if (stage) {
       const transform = stage.getAbsoluteTransform().copy();
       transform.invert();
       
       const topLeft = transform.point({ x: rect.x, y: rect.y });
       const bottomRight = transform.point({ x: rect.x + rect.width, y: rect.y + rect.height });

       let snapLeft = topLeft.x;
       let snapRight = bottomRight.x;
       let snapTop = topLeft.y;
       let snapBottom = bottomRight.y;

       // Left / Right
       if (snapLeft < ROBOT_SNAP_DISTANCE) {
         x += (0 - snapLeft);
       } else if (snapRight > FIELD_WIDTH - ROBOT_SNAP_DISTANCE) {
         x -= (snapRight - FIELD_WIDTH);
       }

       // Top / Bottom
       if (snapTop < ROBOT_SNAP_DISTANCE) {
         y += (0 - snapTop);
       } else if (snapBottom > FIELD_HEIGHT - ROBOT_SNAP_DISTANCE) {
         y -= (snapBottom - FIELD_HEIGHT);
       }
    }
    
    return { x, y };
  };

  const handleRobotDragMove = (e: Konva.KonvaEventObject<DragEvent>) => {
    const node = e.target;
    
    let isShift = modifiersRef.current.shift;
    const evt = window.event as any;
    if (evt && evt.shiftKey !== undefined) isShift = evt.shiftKey;

    if (isShift) {
      const startX = robotState.x;
      const startY = robotState.y;
      const dx = node.x() - startX;
      const dy = node.y() - startY;
      
      if (Math.abs(dx) > Math.abs(dy)) {
        node.position({ x: node.x(), y: startY });
      } else {
        node.position({ x: startX, y: node.y() });
      }
    }

    const { x, y } = constrainRobotPosition(node);
    node.position({ x, y });
  };

  const handleRobotDragEnd = (e: Konva.KonvaEventObject<DragEvent>) => {
    const node = e.target;
    setRobotState({
      ...robotState,
      x: node.x(),
      y: node.y(),
    });
  };

  const handleRobotTransform = () => {
    const node = robotRef.current;
    if (!node) return;

    let rot = node.rotation();
    let isShift = modifiersRef.current.shift;
    let isCtrl = modifiersRef.current.ctrl;

    const evt = window.event as any;
    if (evt) {
      if (evt.shiftKey !== undefined) isShift = evt.shiftKey;
      if (evt.ctrlKey !== undefined || evt.metaKey !== undefined) isCtrl = evt.ctrlKey || evt.metaKey;
    }

    if (isShift) {
      rot = Math.round(rot / 90) * 90;
    } else if (isCtrl) {
      rot = Math.round(rot / 5) * 5;
    }

    node.rotation(rot);
    
    // Lock position to center-of-bounding-box rotation around pivot
    node.x(robotState.x);
    node.y(robotState.y);

    setRobotState(prev => ({ ...prev, rotation: rot }));
  };

  // Drag function for measurement points
  const createLinePointDragFunc = (otherX: number, otherY: number) => (pos: Konva.Vector2d) => {
    const stage = stageRef.current;
    if (!stage) return pos;
    const transform = stage.getAbsoluteTransform().copy();
    transform.invert();
    const localPos = transform.point(pos);
    const snapped = getSnappedPoint(localPos.x, localPos.y);
    const finalPoint = applyAngleSnapping(otherX, otherY, snapped.x, snapped.y);
    
    const absTransform = stage.getAbsoluteTransform();
    return absTransform.point(finalPoint);
  };

  const updateLinePoint = (lineId: string, pointIndex: 0 | 1, x: number, y: number) => {
    const clampedX = Math.max(0, Math.min(x, FIELD_WIDTH));
    const clampedY = Math.max(0, Math.min(y, FIELD_HEIGHT));
    setLines(lines.map(line => {
      if (line.id === lineId) {
        const newPoints = [...line.points] as [number, number, number, number];
        newPoints[pointIndex * 2] = clampedX;
        newPoints[pointIndex * 2 + 1] = clampedY;
        return { ...line, points: newPoints };
      }
      return line;
    }));
  };

  // Drag function for arrow points
  const createArrowPointDragFunc = (otherX: number, otherY: number) => (pos: Konva.Vector2d) => {
    const stage = stageRef.current;
    if (!stage) return pos;
    const transform = stage.getAbsoluteTransform().copy();
    transform.invert();
    const localPos = transform.point(pos);
    const snapped = getSnappedPoint(localPos.x, localPos.y);
    const finalPoint = applyAngleSnapping(otherX, otherY, snapped.x, snapped.y);
    
    const absTransform = stage.getAbsoluteTransform();
    return absTransform.point(finalPoint);
  };

  const updateArrowPoint = (arrowId: string, pointIndex: 0 | 1, x: number, y: number) => {
    const clampedX = Math.max(0, Math.min(x, FIELD_WIDTH));
    const clampedY = Math.max(0, Math.min(y, FIELD_HEIGHT));
    setArrows(arrows.map(a => {
      if (a.id === arrowId) {
        const newPoints = [...a.points] as [number, number, number, number];
        newPoints[pointIndex * 2] = clampedX;
        newPoints[pointIndex * 2 + 1] = clampedY;
        return { ...a, points: newPoints };
      }
      return a;
    }));
  };

  // Reset all shapes and viewport
  const resetAll = () => {
    setLines([]);
    setArrows([]);
    setActionNodes([]);
    setAnnotations([]);
    setActiveLineId(null);
    setActiveArrowId(null);
    setActiveActionNodeId(null);
    setActiveAnnotationId(null);
    setIsRobotSelected(false);
    setDrawingLine(null);
    setContextMenu(null);
    setAnnotationModal(null);
    setRobotState({
      x: FIELD_WIDTH / 2,
      y: FIELD_HEIGHT / 2,
      rotation: 0,
    });
    
    // Fit to container again
    const container = document.querySelector('.canvas-container');
    if (container) {
      const scale = Math.min(
        container.clientWidth / (FIELD_WIDTH + 60),
        container.clientHeight / (FIELD_HEIGHT + 60)
      );
      setStageScale(scale);
      setStagePos({
        x: (container.clientWidth - FIELD_WIDTH * scale) / 2,
        y: (container.clientHeight - FIELD_HEIGHT * scale) / 2,
      });
    }
  };

  const deleteActiveItem = () => {
    if (activeLineId) {
      setLines(lines.filter(l => l.id !== activeLineId));
      setActiveLineId(null);
    } else if (activeArrowId) {
      setArrows(arrows.filter(a => a.id !== activeArrowId));
      setActiveArrowId(null);
    } else if (activeActionNodeId) {
      setActionNodes(actionNodes.filter(n => n.id !== activeActionNodeId));
      setActiveActionNodeId(null);
    } else if (activeAnnotationId) {
      setAnnotations(annotations.filter(a => a.id !== activeAnnotationId));
      setActiveAnnotationId(null);
    }
  };

  const clearAllMarkings = () => {
    setLines([]);
    setArrows([]);
    setActionNodes([]);
    setAnnotations([]);
    setActiveLineId(null);
    setActiveArrowId(null);
    setActiveActionNodeId(null);
    setActiveAnnotationId(null);
    setContextMenu(null);
    setAnnotationModal(null);
  };

  // Setup Transformer
  useEffect(() => {
    if (trRef.current && robotRef.current && mode === 'select') {
      if (isRobotSelected) {
        trRef.current.nodes([robotRef.current]);
      } else {
        trRef.current.nodes([]);
      }
      trRef.current.getLayer()?.batchDraw();
    } else if (trRef.current) {
      trRef.current.nodes([]);
      trRef.current.getLayer()?.batchDraw();
    }
  }, [mode, robotState, isRobotSelected]);

  // Determine if a deletable item is selected
  const hasDeletableSelected = 
    activeLineId !== null || 
    activeArrowId !== null || 
    activeActionNodeId !== null || 
    activeAnnotationId !== null;

  return (
    <div className="app-container">
      {/* Left Sidebar */}
      <div className="sidebar">
        <div className="sidebar-header">
          <h1>WRO 2026 場地工具</h1>
          <p>場地測量與機器人路徑規劃模擬</p>
        </div>
        
        <div className="sidebar-menu">
          <div className="menu-section">
            <span className="section-title">工具選擇</span>
            
            <button 
              className={`tool-btn ${mode === 'select' ? 'active' : ''}`}
              onClick={() => setMode('select')}
              title="選取/移動/編輯場地上的物件"
            >
              <MousePointer2 size={16} />
              <span>選取工具</span>
            </button>
            
            <button 
              className={`tool-btn ${mode === 'measure' ? 'active' : ''}`}
              onClick={() => {
                setMode('measure');
                setActiveLineId(null);
                setActiveArrowId(null);
                setActiveActionNodeId(null);
                setActiveAnnotationId(null);
                setIsRobotSelected(false);
              }}
              title="拉出測量線量取兩點間的距離"
            >
              <Ruler size={16} />
              <span>測量工具</span>
            </button>
            
            <button 
              className={`tool-btn ${mode === 'arrow' ? 'active' : ''}`}
              onClick={() => {
                setMode('arrow');
                setActiveLineId(null);
                setActiveArrowId(null);
                setActiveActionNodeId(null);
                setActiveAnnotationId(null);
                setIsRobotSelected(false);
              }}
              title="拉出路徑箭頭以標示移動路徑"
            >
              <ArrowRight size={16} />
              <span>路徑箭頭</span>
            </button>

            <button 
              className={`tool-btn ${mode === 'action_node' ? 'active' : ''}`}
              onClick={() => {
                setMode('action_node');
                setActiveLineId(null);
                setActiveArrowId(null);
                setActiveActionNodeId(null);
                setActiveAnnotationId(null);
                setIsRobotSelected(false);
              }}
              title="在場地放置動作標記並設定類型"
            >
              <MapPin size={16} />
              <span>動作節點</span>
            </button>

            {/* <button 
              className={`tool-btn ${mode === 'annotation' ? 'active' : ''}`}
              onClick={() => {
                setMode('annotation');
                setActiveLineId(null);
                setActiveArrowId(null);
                setActiveActionNodeId(null);
                setActiveAnnotationId(null);
                setIsRobotSelected(false);
              }}
              title="點擊場地位置加入附指示角之備註"
            >
              <MessageSquare size={16} />
              <span>註解對話框</span>
            </button> */}
          </div>

          <div className="menu-section" style={{ marginTop: 'auto' }}>
            <span className="section-title">場地動作</span>
            
            {hasDeletableSelected && (
              <button className="action-btn action-btn-danger" onClick={deleteActiveItem}>
                <Trash2 size={16} />
                <span>刪除選取物件</span>
              </button>
            )}

            <button className="action-btn action-btn-outline" onClick={clearAllMarkings}>
              <Trash2 size={16} />
              <span>清空所有標記</span>
            </button>

            <button className="action-btn action-btn-outline" onClick={resetAll}>
              <RotateCcw size={16} />
              <span>重置場地</span>
            </button>
          </div>
        </div>

        <div className="sidebar-footer">
          <div className="info-panel">
            <span className="section-title" style={{ margin: 0, paddingBottom: '6px' }}>機器人狀態</span>
            <div className="info-row">
              <span className="info-label">座標 X</span>
              <span className="info-value">{Math.round(robotState.x)} mm</span>
            </div>
            <div className="info-row">
              <span className="info-label">座標 Y</span>
              <span className="info-value">{Math.round(robotState.y)} mm</span>
            </div>
            <div className="info-row">
              <span className="info-label">旋轉角度</span>
              <span className="info-value">{(() => {
                let deg = Math.round(robotState.rotation) % 360;
                if (deg > 180) deg -= 360;
                if (deg <= -180) deg += 360;
                return deg;
              })()}°</span>
            </div>
          </div>
        </div>
      </div>

      {/* Canvas Container */}
      <div className={`canvas-container mode-${mode}`}>
        <Stage
          width={window.innerWidth - 280}
          height={window.innerHeight}
          scaleX={stageScale}
          scaleY={stageScale}
          x={stagePos.x}
          y={stagePos.y}
          draggable={mode === 'select'}
          onWheel={handleWheel}
          onMouseDown={handleStageMouseDown}
          onMouseMove={handleStageMouseMove}
          ref={stageRef}
        >
          {/* Background Layer */}
          <Layer>
            <KonvaImage
              image={bgImage}
              width={FIELD_WIDTH}
              height={FIELD_HEIGHT}
              opacity={0.95}
              name="bg-image"
            />
          </Layer>

          {/* Paths Layer (Arrows & Lines & Nodes & Annotations) */}
          <Layer>
            {/* 1. Draw Measurement Lines */}
            {lines.map((line) => {
              const isActive = line.id === activeLineId;
              const dist = getDistance(line.points[0], line.points[1], line.points[2], line.points[3]);
              const midX = (line.points[0] + line.points[2]) / 2;
              const midY = (line.points[1] + line.points[3]) / 2;
              
              return (
                <Group key={line.id} onClick={(e) => { 
                  if (mode === 'select') {
                    e.cancelBubble = true;
                    setActiveLineId(line.id);
                    setActiveArrowId(null);
                    setActiveActionNodeId(null);
                    setActiveAnnotationId(null);
                    setIsRobotSelected(false);
                  }
                }}>
                  <Line
                    points={line.points}
                    stroke={isActive ? '#ef4444' : '#2563eb'}
                    strokeWidth={isActive ? 3.5 / stageScale : 2.5 / stageScale}
                    hitStrokeWidth={12 / stageScale}
                  />
                  {/* Endpoints */}
                  {isActive && (
                    <>
                      <Circle
                        x={line.points[0]}
                        y={line.points[1]}
                        radius={6 / stageScale}
                        fill="#ef4444"
                        stroke="#ffffff"
                        strokeWidth={1.5 / stageScale}
                        draggable={mode === 'select'}
                        dragBoundFunc={createLinePointDragFunc(line.points[2], line.points[3])}
                        onDragMove={(e) => {
                          const pos = e.target.position();
                          updateLinePoint(line.id, 0, pos.x, pos.y);
                        }}
                        onMouseEnter={e => { if(mode === 'select') e.target.getStage()!.container().style.cursor = 'move'; }}
                        onMouseLeave={e => { e.target.getStage()!.container().style.cursor = 'default'; }}
                      />
                      <Circle
                        x={line.points[2]}
                        y={line.points[3]}
                        radius={6 / stageScale}
                        fill="#ef4444"
                        stroke="#ffffff"
                        strokeWidth={1.5 / stageScale}
                        draggable={mode === 'select'}
                        dragBoundFunc={createLinePointDragFunc(line.points[0], line.points[1])}
                        onDragMove={(e) => {
                          const pos = e.target.position();
                          updateLinePoint(line.id, 1, pos.x, pos.y);
                        }}
                        onMouseEnter={e => { if(mode === 'select') e.target.getStage()!.container().style.cursor = 'move'; }}
                        onMouseLeave={e => { e.target.getStage()!.container().style.cursor = 'default'; }}
                      />
                    </>
                  )}
                  {/* Text Label */}
                  <Text
                    x={midX}
                    y={midY}
                    text={`${dist.toFixed(1)} mm`}
                    fontSize={13 / stageScale}
                    fill="#0f172a"
                    padding={4 / stageScale}
                    align="center"
                    verticalAlign="middle"
                    offsetX={45 / stageScale}
                    offsetY={18 / stageScale}
                    stroke="#ffffff"
                    strokeWidth={3 / stageScale}
                    fillAfterStrokeEnabled
                  />
                </Group>
              );
            })}

            {/* 2. Draw Path Arrows */}
            {arrows.map((arrow) => {
              const isActive = arrow.id === activeArrowId;
              const dist = getDistance(arrow.points[0], arrow.points[1], arrow.points[2], arrow.points[3]);
              const midX = (arrow.points[0] + arrow.points[2]) / 2;
              const midY = (arrow.points[1] + arrow.points[3]) / 2;
              
              return (
                <Group 
                  key={arrow.id} 
                  onClick={(e) => { 
                    if (mode === 'select') {
                      e.cancelBubble = true;
                      setActiveArrowId(arrow.id);
                      setActiveLineId(null);
                      setActiveActionNodeId(null);
                      setActiveAnnotationId(null);
                      setIsRobotSelected(false);
                    }
                  }}
                  onContextMenu={(e) => {
                    if (mode === 'select') {
                      e.evt.preventDefault();
                      e.cancelBubble = true;
                      const stage = stageRef.current;
                      if (stage) {
                        const pointer = stage.getPointerPosition();
                        if (pointer) {
                          setContextMenu({
                            visible: true,
                            x: pointer.x,
                            y: pointer.y,
                            type: 'arrow',
                            targetId: arrow.id,
                          });
                        }
                      }
                    }
                  }}
                >
                  <Arrow
                    points={arrow.points}
                    stroke={arrow.color}
                    fill={arrow.color}
                    strokeWidth={isActive ? 4.5 / stageScale : 3.0 / stageScale}
                    pointerLength={15 / stageScale}
                    pointerWidth={12 / stageScale}
                    hitStrokeWidth={12 / stageScale}
                  />
                  {/* Endpoints */}
                  {isActive && (
                    <>
                      <Circle
                        x={arrow.points[0]}
                        y={arrow.points[1]}
                        radius={6 / stageScale}
                        fill={arrow.color}
                        stroke="#ffffff"
                        strokeWidth={1.5 / stageScale}
                        draggable={mode === 'select'}
                        dragBoundFunc={createArrowPointDragFunc(arrow.points[2], arrow.points[3])}
                        onDragMove={(e) => {
                          const pos = e.target.position();
                          updateArrowPoint(arrow.id, 0, pos.x, pos.y);
                        }}
                        onMouseEnter={e => { if(mode === 'select') e.target.getStage()!.container().style.cursor = 'move'; }}
                        onMouseLeave={e => { e.target.getStage()!.container().style.cursor = 'default'; }}
                      />
                      <Circle
                        x={arrow.points[2]}
                        y={arrow.points[3]}
                        radius={6 / stageScale}
                        fill={arrow.color}
                        stroke="#ffffff"
                        strokeWidth={1.5 / stageScale}
                        draggable={mode === 'select'}
                        dragBoundFunc={createArrowPointDragFunc(arrow.points[0], arrow.points[1])}
                        onDragMove={(e) => {
                          const pos = e.target.position();
                          updateArrowPoint(arrow.id, 1, pos.x, pos.y);
                        }}
                        onMouseEnter={e => { if(mode === 'select') e.target.getStage()!.container().style.cursor = 'move'; }}
                        onMouseLeave={e => { e.target.getStage()!.container().style.cursor = 'default'; }}
                      />
                    </>
                  )}
                  {/* Distance text label */}
                  <Text
                    x={midX}
                    y={midY}
                    text={`${dist.toFixed(1)} mm`}
                    fontSize={13 / stageScale}
                    fill="#0f172a"
                    padding={4 / stageScale}
                    align="center"
                    verticalAlign="middle"
                    offsetX={45 / stageScale}
                    offsetY={18 / stageScale}
                    stroke="#ffffff"
                    strokeWidth={3 / stageScale}
                    fillAfterStrokeEnabled
                  />
                </Group>
              );
            })}

            {/* 3. Draw Action Nodes */}
            {actionNodes.map((node) => {
              const isActive = node.id === activeActionNodeId;
              let actionText = '';
              switch(node.actionType) {
                case 'turn':
                  actionText = `轉 ${node.degrees || 0}°`;
                  break;
                case 'open_clamp':
                  actionText = '打開夾子';
                  break;
                case 'close_clamp':
                  actionText = '關閉夾子';
                  break;
                case 'lift_fork':
                  actionText = '抬起叉子';
                  break;
                case 'lower_fork':
                  actionText = '放下叉子';
                  break;
                case 'custom':
                  actionText = node.customText || '未命名動作';
                  break;
              }

              let nodeColor = '#3b82f6';
              if (node.actionType === 'turn') nodeColor = '#eab308';
              else if (node.actionType === 'open_clamp' || node.actionType === 'close_clamp') nodeColor = '#10b981';
              else if (node.actionType === 'lift_fork' || node.actionType === 'lower_fork') nodeColor = '#a855f7';
              else if (node.actionType === 'custom') nodeColor = '#f97316';

              return (
                <Group
                  key={node.id}
                  x={node.x}
                  y={node.y}
                  draggable={mode === 'select'}
                  onDragMove={(e) => {
                    const clampedX = Math.max(10, Math.min(e.target.x(), FIELD_WIDTH - 10));
                    const clampedY = Math.max(10, Math.min(e.target.y(), FIELD_HEIGHT - 10));
                    e.target.x(clampedX);
                    e.target.y(clampedY);
                  }}
                  onDragEnd={(e) => {
                    setActionNodes(actionNodes.map(n => {
                      if (n.id === node.id) {
                        return { ...n, x: e.target.x(), y: e.target.y() };
                      }
                      return n;
                    }));
                  }}
                  onClick={(e) => {
                    e.cancelBubble = true;
                    if (mode === 'select') {
                      setActiveActionNodeId(node.id);
                      setActiveLineId(null);
                      setActiveArrowId(null);
                      setActiveAnnotationId(null);
                      setIsRobotSelected(false);
                      
                      // Toggle collapse/expand on left click
                      setActionNodes(actionNodes.map(n => {
                        if (n.id === node.id) {
                          return { ...n, isExpanded: !n.isExpanded };
                        }
                        return n;
                      }));
                    }
                  }}
                  onContextMenu={(e) => {
                    if (mode === 'select') {
                      e.evt.preventDefault();
                      e.cancelBubble = true;
                      const stage = stageRef.current;
                      if (stage) {
                        const pointer = stage.getPointerPosition();
                        if (pointer) {
                          setContextMenu({
                            visible: true,
                            x: pointer.x,
                            y: pointer.y,
                            type: 'action_node',
                            targetId: node.id,
                          });
                        }
                      }
                    }
                  }}
                  onMouseEnter={e => { if(mode === 'select') e.target.getStage()!.container().style.cursor = 'pointer'; }}
                  onMouseLeave={e => { e.target.getStage()!.container().style.cursor = 'default'; }}
                >
                  {isActive && (
                    <Circle
                      radius={18 / stageScale}
                      stroke={nodeColor}
                      strokeWidth={2 / stageScale}
                      dash={[4 / stageScale, 4 / stageScale]}
                    />
                  )}
                  <Circle
                    radius={12 / stageScale}
                    fill={nodeColor}
                    stroke="#ffffff"
                    strokeWidth={2 / stageScale}
                    shadowColor="black"
                    shadowBlur={4}
                    shadowOffset={{ x: 1, y: 1 }}
                    shadowOpacity={0.3}
                  />
                  <Text
                    text="A"
                    fontSize={11 / stageScale}
                    fill="#ffffff"
                    fontStyle="bold"
                    align="center"
                    verticalAlign="middle"
                    x={-5 / stageScale}
                    y={-5 / stageScale}
                    width={10 / stageScale}
                    height={10 / stageScale}
                  />

                  {node.isExpanded && (
                    <Label y={-22 / stageScale} offsetX={50 / stageScale}>
                      <Tag
                        fill={nodeColor}
                        cornerRadius={4}
                        shadowColor="rgba(0,0,0,0.15)"
                        shadowBlur={4}
                        stroke="#ffffff"
                        strokeWidth={1 / stageScale}
                      />
                      <Text
                        text={actionText}
                        fontSize={11 / stageScale}
                        fill="#ffffff"
                        fontStyle="bold"
                        padding={5 / stageScale}
                        width={100 / stageScale}
                        align="center"
                      />
                    </Label>
                  )}
                </Group>
              );
            })}

            {/* 4. Draw Annotation Dialogs */}
            {annotations.map((ann) => {
              const isActive = ann.id === activeAnnotationId;
              const textToShow = ann.isExpanded ? ann.text : '💬 註解';
              const dialogWidth = ann.isExpanded ? 140 : 60;
              const dialogHeight = ann.isExpanded ? 50 : 25;

              return (
                <Group key={ann.id}>
                  {/* Pointer line */}
                  <Line
                    points={[ann.x + dialogWidth / 2, ann.y + dialogHeight / 2, ann.targetX, ann.targetY]}
                    stroke="#64748b"
                    strokeWidth={1.5 / stageScale}
                    dash={[4 / stageScale, 4 / stageScale]}
                  />

                  {/* Dialog Box Group */}
                  <Group
                    x={ann.x}
                    y={ann.y}
                    draggable={mode === 'select'}
                    onDragMove={(e) => {
                      const clampedX = Math.max(0, Math.min(e.target.x(), FIELD_WIDTH - dialogWidth));
                      const clampedY = Math.max(0, Math.min(e.target.y(), FIELD_HEIGHT - dialogHeight));
                      e.target.x(clampedX);
                      e.target.y(clampedY);
                    }}
                    onDragEnd={(e) => {
                      setAnnotations(annotations.map(a => {
                        if (a.id === ann.id) {
                          return { ...a, x: e.target.x(), y: e.target.y() };
                        }
                        return a;
                      }));
                    }}
                    onClick={(e) => {
                      e.cancelBubble = true;
                      if (mode === 'select') {
                        setActiveAnnotationId(ann.id);
                        setActiveLineId(null);
                        setActiveArrowId(null);
                        setActiveActionNodeId(null);
                        setIsRobotSelected(false);
                      }
                    }}
                    onDblClick={(e) => {
                      e.cancelBubble = true;
                      if (mode === 'select') {
                        const stage = stageRef.current;
                        if (stage) {
                          const pointer = stage.getPointerPosition();
                          if (pointer) {
                            setAnnotationModal({
                              visible: true,
                              isEdit: true,
                              id: ann.id,
                              x: ann.x,
                              y: ann.y,
                              targetX: ann.targetX,
                              targetY: ann.targetY,
                              text: ann.text,
                            });
                          }
                        }
                      }
                    }}
                    onMouseEnter={e => { if(mode === 'select') e.target.getStage()!.container().style.cursor = 'grab'; }}
                    onMouseLeave={e => { e.target.getStage()!.container().style.cursor = 'default'; }}
                  >
                    <Tag
                      fill={isActive ? '#fef08a' : '#fef9c3'}
                      stroke={isActive ? '#eab308' : '#ca8a04'}
                      strokeWidth={1.5 / stageScale}
                      cornerRadius={6}
                      shadowColor="rgba(0,0,0,0.15)"
                      shadowBlur={6}
                      shadowOffset={{ x: 2, y: 2 }}
                    />
                    <Text
                      text={textToShow}
                      fontSize={11 / stageScale}
                      fill="#451a03"
                      padding={6 / stageScale}
                      width={dialogWidth / stageScale}
                      height={dialogHeight / stageScale}
                      align="left"
                      verticalAlign="middle"
                      wrap="char"
                    />

                    {/* Expand/Collapse Circle Button */}
                    <Group
                      x={dialogWidth - 12}
                      y={6}
                      onClick={(e) => {
                        e.cancelBubble = true;
                        setAnnotations(annotations.map(a => {
                          if (a.id === ann.id) {
                            return { ...a, isExpanded: !a.isExpanded };
                          }
                          return a;
                        }));
                      }}
                      onMouseEnter={e => { e.target.getStage()!.container().style.cursor = 'pointer'; }}
                      onMouseLeave={e => { e.target.getStage()!.container().style.cursor = 'default'; }}
                    >
                      <Circle
                        radius={6 / stageScale}
                        fill="#cbd5e1"
                        stroke="#475569"
                        strokeWidth={0.5 / stageScale}
                      />
                      <Text
                        text={ann.isExpanded ? '-' : '+'}
                        fontSize={10 / stageScale}
                        fill="#0f172a"
                        fontStyle="bold"
                        align="center"
                        verticalAlign="middle"
                        x={-3 / stageScale}
                        y={-5 / stageScale}
                        width={6 / stageScale}
                        height={10 / stageScale}
                      />
                    </Group>
                  </Group>

                  {/* Indicator Target Handle (draggable when selected) */}
                  {isActive && (
                    <Circle
                      x={ann.targetX}
                      y={ann.targetY}
                      radius={6 / stageScale}
                      fill="#ca8a04"
                      stroke="#ffffff"
                      strokeWidth={1.5 / stageScale}
                      draggable={mode === 'select'}
                      onDragMove={(e) => {
                        const stage = stageRef.current;
                        if (stage) {
                          const transform = stage.getAbsoluteTransform().copy();
                          transform.invert();
                          const localPos = transform.point(e.target.position());
                          const snapped = getSnappedPoint(localPos.x, localPos.y);
                          
                          setAnnotations(annotations.map(a => {
                            if (a.id === ann.id) {
                              return { ...a, targetX: snapped.x, targetY: snapped.y };
                            }
                            return a;
                          }));
                          
                          const absTransform = stage.getAbsoluteTransform();
                          const absSnapped = absTransform.point(snapped);
                          e.target.position(absSnapped);
                        }
                      }}
                      onMouseEnter={e => { if(mode === 'select') e.target.getStage()!.container().style.cursor = 'crosshair'; }}
                      onMouseLeave={e => { e.target.getStage()!.container().style.cursor = 'default'; }}
                    />
                  )}
                </Group>
              );
            })}

            {/* Drawing Preview (Lines/Arrows) */}
            {(mode === 'measure' || mode === 'arrow') && drawingLine && (
              <Group>
                {mode === 'arrow' ? (
                  <Arrow
                    points={drawingLine}
                    stroke="#ef4444"
                    fill="#ef4444"
                    strokeWidth={3 / stageScale}
                    pointerLength={15 / stageScale}
                    pointerWidth={12 / stageScale}
                    dash={[5 / stageScale, 5 / stageScale]}
                  />
                ) : (
                  <Line
                    points={drawingLine}
                    stroke="#ef4444"
                    strokeWidth={2 / stageScale}
                    dash={[5 / stageScale, 5 / stageScale]}
                  />
                )}
                <Text
                    x={(drawingLine[0] + drawingLine[2]) / 2}
                    y={(drawingLine[1] + drawingLine[3]) / 2}
                    text={`${getDistance(drawingLine[0], drawingLine[1], drawingLine[2], drawingLine[3]).toFixed(1)} mm`}
                    fontSize={13 / stageScale}
                    fill="#ef4444"
                    stroke="#ffffff"
                    strokeWidth={3 / stageScale}
                    fillAfterStrokeEnabled
                  />
              </Group>
            )}
          </Layer>

          {/* Robot Layer */}
          <Layer>
            <Group
              ref={robotRef}
              width={ROBOT_WIDTH}
              height={ROBOT_HEIGHT}
              x={robotState.x}
              y={robotState.y}
              rotation={robotState.rotation}
              draggable={mode === 'select'}
              onDragStart={() => {
                if (mode === 'select') {
                  setActiveLineId(null);
                  setActiveArrowId(null);
                  setActiveActionNodeId(null);
                  setActiveAnnotationId(null);
                  setIsRobotSelected(true);
                }
              }}
              onDragMove={handleRobotDragMove}
              onDragEnd={handleRobotDragEnd}
              onTransformStart={() => {
                setIsRotating(true);
                setInitialRotation(robotState.rotation);
              }}
              onTransform={handleRobotTransform}
              onTransformEnd={(e) => {
                setIsRotating(false);
                e.target.x(robotState.x);
                e.target.y(robotState.y);
                setRobotState({
                  ...robotState,
                  rotation: e.target.rotation(),
                });
              }}
              offsetX={ROBOT_PIVOT_X}
              offsetY={ROBOT_PIVOT_Y}
              onClick={(e) => {
                e.cancelBubble = true;
                if (mode === 'select') {
                  setActiveLineId(null);
                  setActiveArrowId(null);
                  setActiveActionNodeId(null);
                  setActiveAnnotationId(null);
                  setIsRobotSelected(true);
                }
              }}
              onMouseEnter={e => { if(mode === 'select') e.target.getStage()!.container().style.cursor = 'grab'; }}
              onMouseLeave={e => { e.target.getStage()!.container().style.cursor = 'default'; }}
            >
              <KonvaImage
                image={robotImage}
                width={ROBOT_WIDTH}
                height={ROBOT_HEIGHT}
                shadowColor="rgba(0,0,0,0.3)"
                shadowBlur={10}
                shadowOffset={{ x: 2, y: 2 }}
              />
              <Circle
                x={ROBOT_PIVOT_X}
                y={ROBOT_PIVOT_Y}
                radius={4}
                fill="#ef4444"
              />
            </Group>
            
            {mode === 'select' && (
              <Transformer
                ref={trRef}
                enabledAnchors={[]}
                ignoreStroke={true}
              />
            )}

            {/* Protractor Overlay */}
            {isRotating && (() => {
              const rotAngle = Math.round(robotState.rotation);
              const initAngle = Math.round(initialRotation);
              
              // Calculate angle difference: right positive, left negative, within +-180
              let diffRot = (rotAngle - initAngle) % 360;
              if (diffRot > 180) diffRot -= 360;
              if (diffRot <= -180) diffRot += 360;

              const offsetAngle = -90; // Robot front is UP (-90deg)
              const drawAngleRad = (rotAngle + offsetAngle) * Math.PI / 180;
              const initialAngleRad = (initAngle + offsetAngle) * Math.PI / 180;
              
              const sweepAngle = Math.abs(diffRot);
              const arcStartRotation = diffRot >= 0 
                ? (initAngle + offsetAngle) 
                : (initAngle + offsetAngle + diffRot);

              return (
                <Group x={robotState.x} y={robotState.y}>
                  <Circle radius={160} stroke="white" strokeWidth={4} dash={[10, 10]} globalCompositeOperation="difference" />
                  <Line points={[-170, 0, 170, 0]} stroke="white" strokeWidth={3} globalCompositeOperation="difference" />
                  <Line points={[0, -170, 0, 170]} stroke="white" strokeWidth={3} globalCompositeOperation="difference" />

                  <Circle radius={160} stroke="#60a5fa" strokeWidth={2} dash={[10, 10]} />
                  <Line points={[-170, 0, 170, 0]} stroke="#e2e8f0" strokeWidth={1} />
                  <Line points={[0, -170, 0, 170]} stroke="#e2e8f0" strokeWidth={1} />

                  {/* 1. Indication line of the ORIGINAL heading (原本面朝方向) - dashed blue line */}
                  <Line 
                    points={[0, 0, 160 * Math.cos(initialAngleRad), 160 * Math.sin(initialAngleRad)]} 
                    stroke="#3b82f6" 
                    strokeWidth={3} 
                    dash={[6, 4]} 
                  />

                  {/* 2. Indication line of the CURRENT heading (現在面朝方向) - solid red line */}
                  <Line 
                    points={[0, 0, 160 * Math.cos(drawAngleRad), 160 * Math.sin(drawAngleRad)]} 
                    stroke="#ef4444" 
                    strokeWidth={3} 
                  />
                  
                  {/* 3. Sweep Arc indicating the angle change */}
                  <Arc 
                    innerRadius={0}
                    outerRadius={160}
                    angle={sweepAngle}
                    fill="rgba(239, 68, 68, 0.3)"
                    rotation={arcStartRotation}
                  />
                  
                  {/* 4. Degree Label showing the relative rotation change */}
                  <Label 
                    x={180 * Math.cos(drawAngleRad)} 
                    y={180 * Math.sin(drawAngleRad)}
                    offsetX={25}
                    offsetY={15}
                  >
                    <Tag fill="#ef4444" cornerRadius={4} shadowColor="rgba(0,0,0,0.3)" shadowBlur={4} />
                    <Text text={`${diffRot >= 0 ? '+' : ''}${diffRot}°`} fontSize={16} fill="white" fontStyle="bold" padding={6} />
                  </Label>
                </Group>
              );
            })()}
          </Layer>
        </Stage>
        
        {/* Coordinates overlay */}
        <div className="coords-overlay">
          X: {Math.round(mousePos.x)}, Y: {Math.round(mousePos.y)}
        </div>

        {/* HTML Context Menu overlay */}
        {contextMenu && contextMenu.visible && (
          <div 
            className="custom-context-menu"
            style={{
              position: 'absolute',
              left: `${contextMenu.x}px`,
              top: `${contextMenu.y}px`,
              transform: 'translate(-50%, -100%)',
              marginTop: '-10px',
            }}
          >
            {contextMenu.type === 'arrow' ? (
              <div className="arrow-color-picker">
                <div className="menu-title">選擇路徑顏色</div>
                <div className="color-grid">
                  {COLOR_PALETTE.map((color) => (
                    <button
                      key={color}
                      className="color-swatch"
                      style={{ backgroundColor: color }}
                      onClick={() => {
                        setArrows(arrows.map(a => {
                          if (a.id === contextMenu.targetId) {
                            return { ...a, color };
                          }
                          return a;
                        }));
                        setContextMenu(null);
                      }}
                    />
                  ))}
                </div>
                <button className="confirm-menu-btn" style={{ marginTop: '10px' }} onClick={() => setContextMenu(null)}>
                  關閉
                </button>
              </div>
            ) : (
              <div className="action-config-menu">
                <div className="menu-title">動作設定</div>
                <div className="action-options">
                  {[
                    { type: 'turn', label: '轉 n 度' },
                    { type: 'open_clamp', label: '打開夾子' },
                    { type: 'close_clamp', label: '關閉夾子' },
                    { type: 'lift_fork', label: '抬起叉子' },
                    { type: 'lower_fork', label: '放下叉子' },
                    { type: 'custom', label: '其它描述' }
                  ].map((opt) => {
                    const node = actionNodes.find(n => n.id === contextMenu.targetId);
                    const isSelected = node?.actionType === opt.type;
                    return (
                      <button
                        key={opt.type}
                        className={`action-opt-btn ${isSelected ? 'selected' : ''}`}
                        onClick={() => {
                          setActionNodes(actionNodes.map(n => {
                            if (n.id === contextMenu.targetId) {
                              const updated = { ...n, actionType: opt.type as ActionType };
                              if (opt.type === 'turn' && n.degrees === undefined) updated.degrees = 90;
                              if (opt.type === 'custom' && n.customText === undefined) updated.customText = '自訂動作';
                              return updated;
                            }
                            return n;
                          }));
                        }}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
                
                {(() => {
                  const node = actionNodes.find(n => n.id === contextMenu.targetId);
                  if (!node) return null;
                  if (node.actionType === 'turn') {
                    return (
                      <div className="config-input-group">
                        <label>輸入旋轉度數 (°)</label>
                        <input
                          type="number"
                          value={node.degrees ?? 90}
                          onChange={(e) => {
                            const deg = parseInt(e.target.value) || 0;
                            setActionNodes(actionNodes.map(n => {
                              if (n.id === node.id) return { ...n, degrees: deg };
                              return n;
                            }));
                          }}
                        />
                      </div>
                    );
                  }
                  if (node.actionType === 'custom') {
                    return (
                      <div className="config-input-group">
                        <label>輸入動作內容</label>
                        <input
                          type="text"
                          value={node.customText ?? ''}
                          onChange={(e) => {
                            const text = e.target.value;
                            setActionNodes(actionNodes.map(n => {
                              if (n.id === node.id) return { ...n, customText: text };
                              return n;
                            }));
                          }}
                        />
                      </div>
                    );
                  }
                  return null;
                })()}

                <button className="confirm-menu-btn" onClick={() => setContextMenu(null)}>
                  確定
                </button>
              </div>
            )}
          </div>
        )}

        {/* HTML Modal Dialog for Annotation Text */}
        {annotationModal && annotationModal.visible && (
          <div className="custom-modal-overlay">
            <div className="custom-modal">
              <div className="modal-header">
                <h3>{annotationModal.isEdit ? '編輯註解內容' : '新增註解內容'}</h3>
              </div>
              <div className="modal-body">
                <textarea
                  placeholder="請輸入此點位的備註描述文字..."
                  value={annotationModal.text}
                  onChange={(e) => setAnnotationModal({ ...annotationModal, text: e.target.value })}
                  rows={3}
                  autoFocus
                />
              </div>
              <div className="modal-actions">
                <button 
                  className="modal-btn modal-btn-cancel"
                  onClick={() => {
                    setAnnotationModal(null);
                    if (!annotationModal.isEdit) {
                      setMode('select');
                    }
                  }}
                >
                  取消
                </button>
                <button 
                  className="modal-btn modal-btn-confirm"
                  onClick={() => {
                    if (annotationModal.isEdit && annotationModal.id) {
                      setAnnotations(annotations.map(a => {
                        if (a.id === annotationModal.id) {
                          return { ...a, text: annotationModal.text || '無備註內容' };
                        }
                        return a;
                      }));
                    } else {
                      const newAnn: Annotation = {
                        id: Date.now().toString(),
                        x: annotationModal.x,
                        y: annotationModal.y,
                        targetX: annotationModal.targetX,
                        targetY: annotationModal.targetY,
                        text: annotationModal.text || '無備註內容',
                        isExpanded: true,
                      };
                      setAnnotations([...annotations, newAnn]);
                      setActiveAnnotationId(newAnn.id);
                    }
                    setAnnotationModal(null);
                    setMode('select');
                  }}
                >
                  確定
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
