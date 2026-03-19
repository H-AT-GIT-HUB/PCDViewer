import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { PCDLoader } from 'three/examples/jsm/loaders/PCDLoader.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

interface PCDViewerProps {
  url: string;
}

export default function PCDViewer({ url }: PCDViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Point Cloud States
  const [pointSize, setPointSize] = useState<number>(0.01);
  const [basePointSize, setBasePointSize] = useState<number>(0.01);
  
  // EDL States
  const [edlEnabled, setEdlEnabled] = useState<boolean>(true);
  const [edlStrength, setEdlStrength] = useState<number>(2.0);
  const [edlRadius, setEdlRadius] = useState<number>(1.5);

  // Moving Icon States
  const [showIcon, setShowIcon] = useState<boolean>(true);
  const [iconSpeed, setIconSpeed] = useState<number>(1.0);
  
  // Refs for Three.js objects
  const pointsRef = useRef<THREE.Points | null>(null);
  const materialRef = useRef<THREE.PointsMaterial | null>(null);
  const edlPassRef = useRef<any>(null);
  
  // Refs for Moving Icon
  const iconRef = useRef<THREE.Group | null>(null);
  const trajectoryRef = useRef<THREE.LineLoop | null>(null);
  const pathParamsRef = useRef<{centerX: number, centerZ: number, y: number, radius: number} | null>(null);
  const angleRef = useRef<number>(0);
  
  // Mutable refs for state accessed inside animation loop
  const showIconRef = useRef(showIcon);
  const iconSpeedRef = useRef(iconSpeed);

  // Sync states to refs
  useEffect(() => { showIconRef.current = showIcon; }, [showIcon]);
  useEffect(() => { iconSpeedRef.current = iconSpeed; }, [iconSpeed]);

  // Update point size dynamically
  useEffect(() => {
    if (materialRef.current) {
      materialRef.current.size = pointSize;
    }
  }, [pointSize]);

  // Update EDL parameters dynamically
  useEffect(() => {
    if (edlPassRef.current) {
      edlPassRef.current.enabled = edlEnabled;
      edlPassRef.current.uniforms.edlStrength.value = edlStrength;
      edlPassRef.current.uniforms.edlRadius.value = edlRadius;
    }
  }, [edlEnabled, edlStrength, edlRadius]);

  // Update Icon visibility dynamically
  useEffect(() => {
    if (iconRef.current) iconRef.current.visible = showIcon;
    if (trajectoryRef.current) trajectoryRef.current.visible = showIcon;
  }, [showIcon]);

  useEffect(() => {
    if (!containerRef.current) return;

    const container = containerRef.current;
    
    // Setup Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x09090b); // zinc-950

    // Setup Camera
    const camera = new THREE.PerspectiveCamera(
      45,
      container.clientWidth / container.clientHeight,
      0.01,
      100000
    );
    camera.position.set(0, 0, 10);
    scene.add(camera);

    // Setup Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(renderer.domElement);

    // Setup Post-Processing for EDL
    const target = new THREE.WebGLRenderTarget(container.clientWidth, container.clientHeight);
    target.depthBuffer = true;
    target.depthTexture = new THREE.DepthTexture(container.clientWidth, container.clientHeight);
    target.depthTexture.type = THREE.UnsignedIntType;

    const composer = new EffectComposer(renderer, target);
    const renderPass = new RenderPass(scene, camera);
    composer.addPass(renderPass);

    const EDLShader = {
      uniforms: {
        tDiffuse: { value: null },
        tDepth: { value: null },
        cameraNear: { value: camera.near },
        cameraFar: { value: camera.far },
        screenSize: { value: new THREE.Vector2(container.clientWidth, container.clientHeight) },
        edlStrength: { value: edlStrength },
        edlRadius: { value: edlRadius },
        sceneScale: { value: 1.0 }
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        #include <packing>
        varying vec2 vUv;
        uniform sampler2D tDiffuse;
        uniform sampler2D tDepth;
        uniform float cameraNear;
        uniform float cameraFar;
        uniform vec2 screenSize;
        uniform float edlStrength;
        uniform float edlRadius;
        uniform float sceneScale;

        void main() {
          vec4 texel = texture2D(tDiffuse, vUv);
          float depth = texture2D(tDepth, vUv).x;

          if (depth == 1.0) {
            gl_FragColor = texel;
            return;
          }

          float z = perspectiveDepthToViewZ(depth, cameraNear, cameraFar);
          float res = 0.0;
          vec2 texelSize = 1.0 / screenSize;
          
          vec2 offsets[4];
          offsets[0] = vec2(1.0, 0.0);
          offsets[1] = vec2(-1.0, 0.0);
          offsets[2] = vec2(0.0, 1.0);
          offsets[3] = vec2(0.0, -1.0);

          for(int i = 0; i < 4; i++) {
            float neighborDepth = texture2D(tDepth, vUv + offsets[i] * texelSize * edlRadius).x;
            if (neighborDepth != 1.0) {
              float nz = perspectiveDepthToViewZ(neighborDepth, cameraNear, cameraFar);
              res += max(0.0, nz - z);
            }
          }

          float shade = exp(-res / sceneScale * edlStrength * 10.0);
          gl_FragColor = vec4(texel.rgb * shade, texel.a);
        }
      `
    };

    const edlPass = new ShaderPass(EDLShader);
    edlPass.uniforms.tDepth.value = composer.readBuffer.depthTexture;
    edlPass.enabled = edlEnabled;
    composer.addPass(edlPass);
    edlPassRef.current = edlPass;

    // Setup Controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;

    // Handle Resize
    const handleResize = () => {
      if (!container) return;
      const width = container.clientWidth;
      const height = container.clientHeight;
      
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      
      renderer.setSize(width, height);
      composer.setSize(width, height);
      
      if (edlPassRef.current) {
        edlPassRef.current.uniforms.screenSize.value.set(width, height);
      }
    };
    window.addEventListener('resize', handleResize);

    // Load PCD
    setLoading(true);
    setError(null);
    
    const loader = new PCDLoader();
    let animationFrameId: number;

    loader.load(
      url,
      (points) => {
        pointsRef.current = points;
        
        points.geometry.center();
        points.geometry.computeBoundingSphere();
        
        const material = points.material as THREE.PointsMaterial;
        materialRef.current = material;
        
        if (!points.geometry.hasAttribute('color')) {
          material.color = new THREE.Color(0xffffff);
        }
        
        const boundingSphere = points.geometry.boundingSphere;
        if (boundingSphere) {
          const radius = boundingSphere.radius || 1;
          
          camera.near = radius * 0.0001;
          camera.far = radius * 1000;
          camera.updateProjectionMatrix();

          if (edlPassRef.current) {
            edlPassRef.current.uniforms.cameraNear.value = camera.near;
            edlPassRef.current.uniforms.cameraFar.value = camera.far;
            edlPassRef.current.uniforms.sceneScale.value = radius;
          }

          camera.position.set(0, 0, radius * 2.5);
          controls.target.set(0, 0, 0);
          controls.maxDistance = radius * 50;
          
          const defaultSize = radius * 0.005;
          setBasePointSize(defaultSize);
          setPointSize(defaultSize);
          material.size = defaultSize;
        }

        points.rotation.x = -Math.PI / 2;
        scene.add(points);
        
        // --- Calculate Bounding Box for the Moving Icon Path ---
        points.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(points);
        const center = new THREE.Vector3();
        box.getCenter(center);
        const size = new THREE.Vector3();
        box.getSize(size);
        
        const bottomY = box.min.y;
        const pathRadius = Math.max(size.x, size.z) / 2 * 1.1; // 10% wider than the model
        
        pathParamsRef.current = {
          centerX: center.x,
          centerZ: center.z,
          y: bottomY,
          radius: pathRadius
        };

        // --- Create Moving Icon (A Sphere + Cone pointer) ---
        const iconScale = (boundingSphere?.radius || 1) * 0.05;
        const iconGroup = new THREE.Group();
        
        // Icon Body (Red Sphere)
        const sphereGeo = new THREE.SphereGeometry(iconScale * 0.5, 16, 16);
        const sphereMat = new THREE.MeshBasicMaterial({ color: 0xef4444 });
        const sphere = new THREE.Mesh(sphereGeo, sphereMat);
        
        // Icon Pointer (Yellow Cone)
        const coneGeo = new THREE.ConeGeometry(iconScale * 0.4, iconScale, 16);
        const coneMat = new THREE.MeshBasicMaterial({ color: 0xfbbf24 });
        const cone = new THREE.Mesh(coneGeo, coneMat);
        cone.position.z = iconScale * 0.5; // Move cone forward
        cone.rotation.x = Math.PI / 2;     // Point cone along +Z axis (forward direction for lookAt)
        
        iconGroup.add(sphere);
        iconGroup.add(cone);
        iconGroup.visible = showIconRef.current;
        scene.add(iconGroup);
        iconRef.current = iconGroup;

        // --- Create Trajectory Line (Indigo Circle) ---
        const trajPoints = [];
        for (let i = 0; i <= 64; i++) {
          const angle = (i / 64) * Math.PI * 2;
          trajPoints.push(new THREE.Vector3(
            center.x + pathRadius * Math.cos(angle),
            bottomY,
            center.z + pathRadius * Math.sin(angle)
          ));
        }
        const trajGeo = new THREE.BufferGeometry().setFromPoints(trajPoints);
        const trajMat = new THREE.LineBasicMaterial({ color: 0x6366f1, transparent: true, opacity: 0.5 });
        const trajLine = new THREE.LineLoop(trajGeo, trajMat);
        trajLine.visible = showIconRef.current;
        scene.add(trajLine);
        trajectoryRef.current = trajLine;

        setLoading(false);
      },
      (xhr) => {},
      (err) => {
        console.error('An error happened loading the PCD file', err);
        setError('Failed to load PCD file. Ensure it is a valid format.');
        setLoading(false);
      }
    );

    // Animation Loop
    let lastTime = performance.now();
    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);
      
      const currentTime = performance.now();
      const delta = (currentTime - lastTime) / 1000;
      lastTime = currentTime;

      // Update Moving Icon Position
      if (iconRef.current && pathParamsRef.current && showIconRef.current) {
        angleRef.current += iconSpeedRef.current * delta;
        const p = pathParamsRef.current;
        
        // Current position
        const x = p.centerX + p.radius * Math.cos(angleRef.current);
        const z = p.centerZ + p.radius * Math.sin(angleRef.current);
        
        // Next position (slightly ahead) to determine where the icon should "look"
        const nextX = p.centerX + p.radius * Math.cos(angleRef.current + 0.1);
        const nextZ = p.centerZ + p.radius * Math.sin(angleRef.current + 0.1);
        
        iconRef.current.position.set(x, p.y, z);
        iconRef.current.lookAt(nextX, p.y, nextZ);
      }

      controls.update();
      composer.render(); // Use composer instead of renderer for EDL
    };
    animate();

    // Cleanup
    return () => {
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(animationFrameId);
      
      if (pointsRef.current) {
        scene.remove(pointsRef.current);
        pointsRef.current.geometry.dispose();
        if (Array.isArray(pointsRef.current.material)) {
          pointsRef.current.material.forEach(m => m.dispose());
        } else {
          pointsRef.current.material.dispose();
        }
      }

      if (iconRef.current) {
        scene.remove(iconRef.current);
        // Clean up icon geometries/materials
        iconRef.current.children.forEach((child: any) => {
          if (child.geometry) child.geometry.dispose();
          if (child.material) child.material.dispose();
        });
      }

      if (trajectoryRef.current) {
        scene.remove(trajectoryRef.current);
        trajectoryRef.current.geometry.dispose();
        (trajectoryRef.current.material as THREE.Material).dispose();
      }
      
      composer.dispose();
      target.dispose();
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [url]);

  return (
    <div className="w-full h-full relative flex flex-col">
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-zinc-950/80 z-10">
          <div className="flex flex-col items-center">
            <div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mb-4"></div>
            <p className="text-zinc-300">Loading Point Cloud...</p>
          </div>
        </div>
      )}
      
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-zinc-950/80 z-10">
          <div className="bg-red-900/20 border border-red-500/50 text-red-400 px-6 py-4 rounded-lg max-w-md text-center">
            <p>{error}</p>
          </div>
        </div>
      )}
      
      <div ref={containerRef} className="flex-1 w-full" />
      
      <div className="absolute bottom-4 left-4 bg-zinc-900/80 backdrop-blur-sm border border-zinc-800 p-4 rounded-lg flex flex-col gap-3 min-w-[240px] max-h-[80vh] overflow-y-auto">
        <div className="text-xs text-zinc-400 space-y-1">
          <p>Left Click: Rotate</p>
          <p>Right Click: Pan</p>
          <p>Scroll: Zoom</p>
        </div>
        
        <div className="border-t border-zinc-800 pt-3">
          <label className="text-xs text-zinc-300 flex justify-between mb-2">
            <span>Point Size</span>
            <span>{pointSize.toFixed(4)}</span>
          </label>
          <input 
            type="range" 
            min={basePointSize * 0.1} 
            max={basePointSize * 20} 
            step={basePointSize * 0.1}
            value={pointSize}
            onChange={(e) => setPointSize(parseFloat(e.target.value))}
            className="w-full accent-indigo-500"
          />
        </div>

        <div className="border-t border-zinc-800 pt-3">
          <label className="flex items-center gap-2 text-xs text-zinc-300 mb-3 cursor-pointer">
            <input 
              type="checkbox" 
              checked={edlEnabled}
              onChange={(e) => setEdlEnabled(e.target.checked)}
              className="accent-indigo-500 rounded"
            />
            Enable EDL (Eye Dome Lighting)
          </label>
          
          {edlEnabled && (
            <div className="space-y-3">
              <div>
                <label className="text-xs text-zinc-400 flex justify-between mb-1">
                  <span>EDL Strength</span>
                  <span>{edlStrength.toFixed(1)}</span>
                </label>
                <input 
                  type="range" 
                  min="0.1" max="10" step="0.1"
                  value={edlStrength}
                  onChange={(e) => setEdlStrength(parseFloat(e.target.value))}
                  className="w-full accent-indigo-500"
                />
              </div>
              <div>
                <label className="text-xs text-zinc-400 flex justify-between mb-1">
                  <span>EDL Radius</span>
                  <span>{edlRadius.toFixed(1)}</span>
                </label>
                <input 
                  type="range" 
                  min="0.5" max="5" step="0.1"
                  value={edlRadius}
                  onChange={(e) => setEdlRadius(parseFloat(e.target.value))}
                  className="w-full accent-indigo-500"
                />
              </div>
            </div>
          )}
        </div>

        <div className="border-t border-zinc-800 pt-3">
          <label className="flex items-center gap-2 text-xs text-zinc-300 mb-3 cursor-pointer">
            <input 
              type="checkbox" 
              checked={showIcon}
              onChange={(e) => setShowIcon(e.target.checked)}
              className="accent-indigo-500 rounded"
            />
            Show Moving Icon
          </label>
          
          {showIcon && (
            <div>
              <label className="text-xs text-zinc-400 flex justify-between mb-1">
                <span>Move Speed</span>
                <span>{iconSpeed.toFixed(1)}x</span>
              </label>
              <input 
                type="range" 
                min="0.1" max="5" step="0.1"
                value={iconSpeed}
                onChange={(e) => setIconSpeed(parseFloat(e.target.value))}
                className="w-full accent-indigo-500"
              />
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
