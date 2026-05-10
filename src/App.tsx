import { useState, useRef, useEffect } from 'react';
import { Stage, Layer, Image as KonvaImage, Line, Circle, Text, Group, Transformer } from 'react-konva';
import useImage from 'use-image';
import { MousePointer2, Ruler, RotateCcw, Trash2 } from 'lucide-react';
import Konva from 'konva';

// --- Constants ---
const FIELD_WIDTH = 2362;
const FIELD_HEIGHT = 1143;
const ROBOT_WIDTH = 208;
const ROBOT_HEIGHT = 215;
const ROBOT_PIVOT_X = 104;
const ROBOT_PIVOT_Y = 130;
const ROBOT_SNAP_DISTANCE = 5;
const MEASURE_SNAP_DISTANCE = 10;

// --- Types ---
type Mode = 'select' | 'measure';
type MeasurementLine = {
  id: string;
  points: [number, number, number, number];
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

// --- Helper Functions ---
const getDistance = (x1: number, y1: number, x2: number, y2: number) => {
  return Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
};

export default function App() {
  const [mode, setMode] = useState<Mode>('select');
  const [lines, setLines] = useState<MeasurementLine[]>([]);
  const [activeLineId, setActiveLineId] = useState<string | null>(null);
  const [isRobotSelected, setIsRobotSelected] = useState<boolean>(false);
  const [drawingLine, setDrawingLine] = useState<[number, number, number, number] | null>(null);
  
  const [robotState, setRobotState] = useState<RobotState>({
    x: FIELD_WIDTH / 2,
    y: FIELD_HEIGHT / 2,
    rotation: 0,
  });
  
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
        container.clientWidth / (FIELD_WIDTH + 100),
        container.clientHeight / (FIELD_HEIGHT + 100)
      );
      setStageScale(scale);
      setStagePos({
        x: (container.clientWidth - FIELD_WIDTH * scale) / 2,
        y: (container.clientHeight - FIELD_HEIGHT * scale) / 2,
      });
    }
  }, []);

  // Handle Robot Transformer
  useEffect(() => {
    if (mode === 'select' && activeLineId === null && trRef.current && robotRef.current) {
      // trRef.current.nodes([robotRef.current]);
      // We'll attach it conditionally below
    }
  }, [mode, activeLineId]);

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
    // Limit scale
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

  // Snapping Logic for Measurement Tool
  const getSnappedPoint = (rawX: number, rawY: number) => {
    const x = Math.max(0, Math.min(rawX, FIELD_WIDTH));
    const y = Math.max(0, Math.min(rawY, FIELD_HEIGHT));

    let snappedX = x;
    let snappedY = y;
    let minSnapDist = MEASURE_SNAP_DISTANCE;

    // 1. Snap to Field Edges
    if (Math.abs(x - 0) < minSnapDist) snappedX = 0;
    if (Math.abs(x - FIELD_WIDTH) < minSnapDist) snappedX = FIELD_WIDTH;
    if (Math.abs(y - 0) < minSnapDist) snappedY = 0;
    if (Math.abs(y - FIELD_HEIGHT) < minSnapDist) snappedY = FIELD_HEIGHT;

    // 2. Snap to Robot Center
    if (getDistance(x, y, robotState.x, robotState.y) < minSnapDist) {
      snappedX = robotState.x;
      snappedY = robotState.y;
    }

    // 3. Snap to Robot Bounding Box Corners
    if (robotRef.current) {
      const rect = robotRef.current.getClientRect({ skipTransform: false, skipShadow: true });
      const stage = stageRef.current;
      if (stage) {
        // clientRect is in absolute coordinates (scaled by stage). We need local coords.
        const transform = stage.getAbsoluteTransform().copy();
        transform.invert();
        
        const corners = [
          transform.point({ x: rect.x, y: rect.y }),
          transform.point({ x: rect.x + rect.width, y: rect.y }),
          transform.point({ x: rect.x, y: rect.y + rect.height }),
          transform.point({ x: rect.x + rect.width, y: rect.y + rect.height }),
        ];

        for (const c of corners) {
          if (getDistance(x, y, c.x, c.y) < minSnapDist) {
            snappedX = c.x;
            snappedY = c.y;
            break; // snap to first corner found
          }
        }
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
      setIsRobotSelected(false);
    }

    if (mode === 'measure') {
      const pos = getRelativePointerPosition();
      if (!pos) return;
      const snapped = getSnappedPoint(pos.x, pos.y);
      
      if (!drawingLine) {
        // Start drawing
        setDrawingLine([snapped.x, snapped.y, snapped.x, snapped.y]);
      } else {
        // Finish drawing
        const finalPoint = applyAngleSnapping(drawingLine[0], drawingLine[1], snapped.x, snapped.y);
        const newLine = {
          id: Date.now().toString(),
          points: [drawingLine[0], drawingLine[1], finalPoint.x, finalPoint.y] as [number, number, number, number],
        };
        setLines([...lines, newLine]);
        setDrawingLine(null);
        setActiveLineId(newLine.id);
        setMode('select'); // Auto switch back to select
      }
    }
  };

  const handleStageMouseMove = () => {
    const pos = getRelativePointerPosition();
    if (!pos) return;
    setMousePos(pos);

    if (mode === 'measure' && drawingLine) {
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
       // Get bounding box in local coordinates
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

    // fallback to native event to be absolutely safe during drag
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
    
    // Lock position to prevent Transformer from translating the node
    // to compensate for its default center-of-bounding-box rotation.
    // This forces it to rotate exactly around our custom offset (pivot).
    node.x(robotState.x);
    node.y(robotState.y);
  };

  // We use dragBoundFunc for endpoints of measurement lines
  const createLinePointDragFunc = (otherX: number, otherY: number) => (pos: Konva.Vector2d) => {
    const stage = stageRef.current;
    if (!stage) return pos;
    const transform = stage.getAbsoluteTransform().copy();
    transform.invert();
    const localPos = transform.point(pos);
    const snapped = getSnappedPoint(localPos.x, localPos.y);
    const finalPoint = applyAngleSnapping(otherX, otherY, snapped.x, snapped.y);
    
    // Return to absolute coordinates for Konva dragBoundFunc
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

  const resetAll = () => {
    setLines([]);
    setActiveLineId(null);
    setIsRobotSelected(false);
    setDrawingLine(null);
    setRobotState({
      x: FIELD_WIDTH / 2,
      y: FIELD_HEIGHT / 2,
      rotation: 0,
    });
  };

  const deleteActiveLine = () => {
    if (activeLineId) {
      setLines(lines.filter(l => l.id !== activeLineId));
      setActiveLineId(null);
    }
  };

  const deleteAllLines = () => {
    setLines([]);
    setActiveLineId(null);
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

  return (
    <div className="app-container">
      {/* Toolbar */}
      <div className="toolbar">
        <h1>WRO 2026 場地測量工具</h1>
        
        <div className="toolbar-actions">
          <button 
            className={`btn ${mode === 'select' ? 'btn-primary' : 'btn-outline'}`}
            onClick={() => setMode('select')}
            title="選取/移動模式"
          >
            <MousePointer2 size={18} />
            <span>選取</span>
          </button>
          
          <button 
            className={`btn ${mode === 'measure' ? 'btn-primary' : 'btn-outline'}`}
            onClick={() => {
              setMode('measure');
              setActiveLineId(null);
            }}
            title="測量模式"
          >
            <Ruler size={18} />
            <span>測量</span>
          </button>
          
          <div style={{ width: '1px', height: '24px', background: '#e2e8f0', margin: '0 8px' }}></div>
          
          {activeLineId && (
            <button className="btn btn-danger" onClick={deleteActiveLine}>
              <Trash2 size={18} />
              <span>刪除測量線</span>
            </button>
          )}

          <button className="btn btn-danger" onClick={deleteAllLines}>
            <Trash2 size={18} />
            <span>刪除所有測量線</span>
          </button>

          <button className="btn btn-outline" onClick={resetAll}>
            <RotateCcw size={18} />
            <span>重置</span>
          </button>
        </div>
      </div>

      {/* Canvas */}
      <div className={`canvas-container mode-${mode}`}>
        <Stage
          width={window.innerWidth}
          height={window.innerHeight - 64}
          scaleX={stageScale}
          scaleY={stageScale}
          x={stagePos.x}
          y={stagePos.y}
          draggable={mode === 'select'} // stage is always draggable in select mode, shape dragging stops propagation
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
              opacity={0.9}
              name="bg-image"
            />
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
                  setIsRobotSelected(true);
                }
              }}
              onDragMove={handleRobotDragMove}
              onDragEnd={handleRobotDragEnd}
              onTransform={handleRobotTransform}
              onTransformEnd={(e) => {
                // Ensure the node physically snaps back to the correct position
                // in case Konva's internal transform bypassed our locks on the last frame
                e.target.x(robotState.x);
                e.target.y(robotState.y);
                setRobotState({
                  ...robotState,
                  rotation: e.target.rotation(),
                });
              }}
              // Pivot point in Konva is 'offset'. When we set offset, the (x,y) becomes the offset point.
              offsetX={ROBOT_PIVOT_X}
              offsetY={ROBOT_PIVOT_Y}
              onClick={() => {
                if (mode === 'select') {
                  setActiveLineId(null);
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
              {/* Pivot Indicator */}
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
                enabledAnchors={[]} // disable scale anchors, only keep rotation
                ignoreStroke={true}
              />
            )}
          </Layer>

          {/* Lines Layer */}
          <Layer>
            {lines.map((line) => {
              const isActive = line.id === activeLineId;
              const dist = getDistance(line.points[0], line.points[1], line.points[2], line.points[3]);
              const midX = (line.points[0] + line.points[2]) / 2;
              const midY = (line.points[1] + line.points[3]) / 2;
              
              return (
                <Group key={line.id} onClick={() => { 
                  if(mode === 'select') {
                    setActiveLineId(line.id);
                    setIsRobotSelected(false);
                  }
                }}>
                  <Line
                    points={line.points}
                    stroke={isActive ? '#ef4444' : '#2563eb'}
                    strokeWidth={isActive ? 3 / stageScale : 2 / stageScale}
                    hitStrokeWidth={10 / stageScale}
                  />
                  {/* Endpoints */}
                  <Circle
                    x={line.points[0]}
                    y={line.points[1]}
                    radius={5 / stageScale}
                    fill={isActive ? '#ef4444' : '#2563eb'}
                    draggable={mode === 'select' && isActive}
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
                    radius={5 / stageScale}
                    fill={isActive ? '#ef4444' : '#2563eb'}
                    draggable={mode === 'select' && isActive}
                    dragBoundFunc={createLinePointDragFunc(line.points[0], line.points[1])}
                    onDragMove={(e) => {
                      const pos = e.target.position();
                      updateLinePoint(line.id, 1, pos.x, pos.y);
                    }}
                    onMouseEnter={e => { if(mode === 'select') e.target.getStage()!.container().style.cursor = 'move'; }}
                    onMouseLeave={e => { e.target.getStage()!.container().style.cursor = 'default'; }}
                  />
                  {/* Text Label */}
                  <Text
                    x={midX}
                    y={midY}
                    text={`${dist.toFixed(1)} mm`}
                    fontSize={14 / stageScale}
                    fill="#1e293b"
                    padding={4 / stageScale}
                    align="center"
                    verticalAlign="middle"
                    offsetX={50 / stageScale} // approximate center offset
                    offsetY={20 / stageScale}
                    stroke="#ffffff"
                    strokeWidth={3 / stageScale}
                    fillAfterStrokeEnabled
                  />
                </Group>
              );
            })}

            {/* Drawing Preview Line */}
            {mode === 'measure' && drawingLine && (
              <Group>
                <Line
                  points={drawingLine}
                  stroke="#ef4444"
                  strokeWidth={2 / stageScale}
                  dash={[5 / stageScale, 5 / stageScale]}
                />
                <Text
                    x={(drawingLine[0] + drawingLine[2]) / 2}
                    y={(drawingLine[1] + drawingLine[3]) / 2}
                    text={`${getDistance(drawingLine[0], drawingLine[1], drawingLine[2], drawingLine[3]).toFixed(1)} mm`}
                    fontSize={14 / stageScale}
                    fill="#ef4444"
                    stroke="#ffffff"
                    strokeWidth={3 / stageScale}
                    fillAfterStrokeEnabled
                  />
              </Group>
            )}
          </Layer>
        </Stage>
        
        {/* Coordinates overlay */}
        <div className="coords-overlay">
          X: {Math.round(mousePos.x)}, Y: {Math.round(mousePos.y)}
        </div>
      </div>
    </div>
  );
}
