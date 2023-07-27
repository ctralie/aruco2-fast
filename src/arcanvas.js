import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

const CANVAS_FAC = 1;

function rot3dArr2glMatrix(r) {
    return glMatrix.mat3.fromValues(
        r[0][0], r[0][1], r[0][2], 
        r[1][0], r[1][1], r[1][2],
        r[2][0], r[2][1], r[2][2]
    );
}

function glMatrix2Rot3dArr(m) {
    return [[m[0], m[1], m[2]], [m[3], m[4], m[5]], [m[6], m[7], m[8]]];
}

/**
 * Update a DOM element to be fixed in the upper left of the screen
 * @param {DOM Element} element Element to update
 */
function setUpperLeft(element) {
    element['style']['position'] = "absolute";
    element['style']['top'] = 0;
    element['style']['left'] = 0;
    element['style']['text-align'] = "left";
}

/**
 * Set the width and height of a DOM element in pixels
 * @param {DOM Element} element Element to update
 * @param {float} width Width, in pixels
 * @param {float} height Height, in pixels
 */
function setWidthHeight(element, width, height) {
    element['style']['width'] = width + "px";
    element['style']['height'] = height + "px";
}

/**
 * Create a Three.js texture that holds a video stream
 * @param {object} video HTML5 Video object
 * @returns Three.js object with a video texture
 */
function createVideoTexture(video){
    let texture = new THREE.VideoTexture(video);
    let object = new THREE.Object3D();
    let geometry = new THREE.BoxGeometry(1.0, 1.0, 0.01);
    let material = new THREE.MeshBasicMaterial({map: texture, depthTest: false, depthWrite: false});
    let mesh = new THREE.Mesh(geometry, material);
    object.position.z = -1;
    object.add(mesh);
    return object;
}

/**
 * Update affine parameters of a three.js object
 * @param {three.js object} object Object to update
 * @param {float} scale New scale (uniform in x, y, and z)
 * @param {2d array} rotation 3x3 rotation matrix
 * @param {array} translation xyz position
 */
function updateObject(object, scale, rotation, translation){
    object.scale.x = scale;
    object.scale.y = scale;
    object.scale.z = scale;

    object.rotation.x = -Math.asin(-rotation[1][2]);
    object.rotation.y = -Math.atan2(rotation[0][2], rotation[2][2]);
    object.rotation.z = Math.atan2(rotation[1][0], rotation[1][1]);

    object.position.x = translation[0];
    object.position.y = translation[1];
    object.position.z = -translation[2];
}

class ARCanvas {
    /**
     * 
     * @param {string} divName The name of the div to which to add
     *                         this ARCanvas session
     * @param {object} scene An object containing a THREE.Group sceneRoot,
     * which is the root of the scene anchored to the markers, as well as
     * a step(dt) method which moves time forward for that scene
     * @param {float} modelSize Size of each marker in millimeters
     * @param {dict} config Aruco detector configuration parameters
     * @param {int} k Number of markers being used
     */
    constructor(divName, scene, modelSize=174.6, config={}) {
        let div = document.getElementById(divName);
        this.div = div;
        this.scene = scene;
        this.sceneRoot = scene.sceneRoot;
        this.modelSize = modelSize;

        // Setup start button
        let startButton = document.createElement("button");
        startButton.innerHTML = "<h1>Start</h1>";
        startButton.onclick = this.initializeVideo.bind(this);
        div.appendChild(startButton);
        this.startButton = startButton;

        // Setup AR detector object
        let detector = new AR.Detector(config);
        const nMarkers = config.nMarkers || 10;
        const markers = getDictionaryFurthest(detector.dictionary, nMarkers);
        detector.markers = markers;
        detector.dictionary.codeList = markers.map(i => detector.dictionary.codeList[i]);
        this.detector = detector;
    }

    /**
     * Initialize a (back facing) video stream to fill the available window
     * as well as possible
     * 
     * As a side effect, remove the "start" button
     */
    initializeVideo() {
        const that = this;
        const div = this.div;
        let video = document.createElement("video");
        this.startButton.style.display = "none";
        // Suggested on https://github.com/jeeliz/jeelizFaceFilter/issues/14#issuecomment-682209245
        video['style']['transform'] = 'scale(0.1,0.1)';
        setUpperLeft(video);
        video.setAttribute("muted", '');
        video.setAttribute("playsinline", '');
        video.setAttribute("autoplay", '');
        video.setAttribute("loop", '');
        this.video = video;

        let renderArea = document.createElement("div");
        setUpperLeft(renderArea);
        this.renderArea = renderArea;
        div.appendChild(renderArea);

        let debugArea = document.createElement("p");
        setUpperLeft(debugArea);
        this.debugArea = debugArea;
        div.appendChild(debugArea);

        if (navigator.mediaDevices === undefined) {
            navigator.mediaDevices = {};
        }
        if (navigator.mediaDevices.getUserMedia === undefined) {
            navigator.mediaDevices.getUserMedia = function(constraints) {
                let getUserMedia = navigator.webkitGetUserMedia || navigator.mozGetUserMedia;
                if (!getUserMedia) {
                    return Promise.reject(new Error('getUserMedia is not implemented in this browser'));
                }
                return new Promise(function(resolve, reject) {
                    getUserMedia.call(navigator, constraints, resolve, reject);
                });
            }
        }
        navigator.mediaDevices.getUserMedia({
            video:{
                width: 320,
                height: 240,
                facingMode: "environment"
            }
        }).then(async stream => {
            await new Promise(resolve => setTimeout(resolve, 1000));
            if ("srcObject" in video) {
                video.srcObject = stream;
            }
            else {
                video.src = window.URL.createObjectURL(stream);
            }
            video.onloadeddata = function() {
                that.videoTexture = createVideoTexture(video);
                that.videoTextureFilter = createVideoTexture(video);
                that.initializeCanvas();
                that.setupScene();
                that.repaint();
            }
        }).catch(function(err) {
            console.log(err);
        })
    }

    /**
     * Make the canvas as large as possible, preserving
     * the aspect ratio of the video
     */
    resizeRenderer() {
        let vw = this.video.videoWidth;
        let vh = this.video.videoHeight;
        let w = window.innerWidth*CANVAS_FAC;
        let h = vh*w/vw;
        if (h > window.innerHeight) {
            const fac = window.innerHeight/h;
            h *= fac;
            w *= fac;
        }
        if (!(this.renderer == undefined)) {
            setWidthHeight(this.renderer.domElement, w, h);
        }
    }

    /**
     * Initialize a canvas to which to draw the video frame,
     * as well as a position tracker object to estimate positions
     * on canvas of the appropriate size
     */
    initializeCanvas() {
        const canvas = document.createElement("canvas");
        canvas.width = this.video.videoWidth;
        canvas.height = this.video.videoHeight;
        this.canvas = canvas;
        //this.renderArea.appendChild(canvas);
        this.context = canvas.getContext("2d");
        this.posit = new POS.Posit(this.modelSize, this.video.videoWidth);
        this.lastTime = new Date();
        this.startTime = this.lastTime;
        this.framesRendered = 0;
    }

    /**
     * Setup a perspective camera for the three.js scene with the proper
     * field of view, and setup a video texture for the streaming video
     */
    setupScene() {
        const renderArea = this.renderArea;
        renderArea.width = this.video.videoWidth;
        renderArea.height = this.video.videoHeight;
        let W = this.video.videoWidth;
        let H = this.video.videoHeight;

        // Step 1: Setup scene and link in scene root
        const parentScene = new THREE.Scene();
        this.parentScene = parentScene;
        let fov = 40;
        if (H > W) {
            fov = 2*Math.atan((H/W)*Math.tan((fov/2)*Math.PI/180));
            fov *= 180/Math.PI;
            fov *= 1.3; // TODO: This is a hack for vertically oriented cameras; I'm not sure why it works
        }
        this.fov = fov;
        const camera = new THREE.PerspectiveCamera(fov, W/H, 1, 10000);
        this.camera = camera;
        parentScene.add(camera);
        parentScene.add(this.sceneRoot);
        const intensity = 1;
        const light = new THREE.DirectionalLight(0xFFFFFF, intensity);
        light.position.set(0, 0, 0);
        parentScene.add(light);


        // Step 2: Setup simple orthographic scene for displaying video texture
        this.videoScene = new THREE.Scene();
        this.videoCamera = new THREE.OrthographicCamera(-0.5, 0.5, 0.5, -0.5);
        this.videoScene.add(this.videoCamera);
        this.videoScene.add(this.videoTexture);
        // Step 2b: Setup a duplicate of this to use with CV filters for the
        // marker detection
        this.cvScene = new THREE.Scene();
        this.cvCamera = new THREE.OrthographicCamera(-0.5, 0.5, 0.5, -0.5);
        this.cvScene.add(this.cvCamera);
        this.cvScene.add(this.videoTextureFilter);

        // Step 3: Setup renderer object for scene and camera
        const renderer = new THREE.WebGLRenderer({antialias:true});
        this.renderer = renderer;
        renderer.setClearColor(0xffffff, 1);
        renderer.setSize(this.canvas.width*3, this.canvas.height*3);
        renderArea.appendChild(renderer.domElement);

        // Step 4: Setup composite renderer for the CV filters
        this.cvPixels = new Uint8ClampedArray(4*this.video.videoWidth*this.video.videoHeight);
        const cvRenderer = new THREE.WebGLRenderer({antialias:false});
        //renderArea.appendChild(cvRenderer.domElement);
        cvRenderer.setSize(this.video.videoWidth, this.video.videoHeight);
        this.cvRenderer = cvRenderer;
        let cvFilters = new EffectComposer(cvRenderer);
        const initialWebcam = new RenderPass(this.cvScene, this.cvCamera);
        cvFilters.addPass(initialWebcam);

        this.grayscaleFilter = new ShaderPass(CV.GrayscaleAndFlipShader);
        cvFilters.addPass(this.grayscaleFilter);

        //const scenePass = new RenderPass(this.parentScene, this.camera);
        //composer.addPass(scenePass);
        this.cvFilters = cvFilters;
        this.cvgl = cvRenderer.getContext("webgl");

        this.img = document.createElement("img");
        renderArea.appendChild(this.img);

        window.onresize = this.resizeRenderer.bind(this);
        this.resizeRenderer();
    }

    /**
     * Output the IDs of the markers to the canvas for debugging
     * @param {list} markers List of markers
     */
    printMarkers(markers) {
        this.debugArea.innerHTML += "<p>Detected: ";
        if (markers.length > 0) {
            let ids = []
            for (let i = 0; i < markers.length; i++) {
                ids.push(parseInt(markers[i].id));
            }
            ids.sort((a, b) => a - b);
            this.debugArea.innerHTML += JSON.stringify(ids);
        }
        this.debugArea.innerHTML += "</p>";
    }

    /**
     * Draw the corners of all of the markers to the canvas for
     * debugging
     * @param {list} markers List of markers
     */
    drawCorners(markers){
        const context = this.context;
        let corners, corner, i, j;
        context.lineWidth = 3;
        for (i = 0; i < markers.length; ++ i){
            corners = markers[i].corners;
            context.strokeStyle = "red";
            context.beginPath();
            for (j = 0; j < corners.length; ++ j){
                corner = corners[j];
                context.moveTo(corner.x, corner.y);
                corner = corners[(j + 1) % corners.length];
                context.lineTo(corner.x, corner.y);
            }
            context.stroke();
            context.closePath();
            context.strokeStyle = "green";
            context.strokeRect(corners[0].x - 2, corners[0].y - 2, 4, 4);
        }
    }

    /**
     * Infer the pose from the detected markers
     * @param {list} markers List of markers
     */
    getPose(markers) {
        const video = this.video;
        let pose = null;
        for (let i = 0; i < markers.length; i++) {
            let corners = markers[i].corners;
            for (let k = 0; k < corners.length; k++) {
                let corner = corners[k];
                corner.x = corner.x - video.videoWidth/2;
                corner.y = video.videoHeight/2 - corner.y;
            }
            pose = this.posit.pose(corners);
        }
        return pose;
    }

    repaint() {
        const canvas = this.canvas;
        const video = this.video;
        const context = this.context;
        const renderer = this.renderer;
        let thisTime = new Date();
        let elapsed = thisTime - this.lastTime;
        this.scene.step(elapsed);
        this.lastTime = thisTime;
        this.framesRendered += 1;
        this.debugArea.innerHTML = "";
        if (video.readyState === video.HAVE_ENOUGH_DATA) {
            this.debugArea.innerHTML += "Successful streaming<p>" + Math.round(1000*this.framesRendered/(thisTime-this.startTime)) + " fps, " + video.videoWidth + " x " + video.videoHeight + ", fov " + this.fov + "</p>";

            /*
            this.cvFilters.render();
            this.cvgl.readPixels(0, 0, this.video.videoWidth, this.video.videoHeight, this.cvgl.RGBA, this.cvgl.UNSIGNED_BYTE, this.cvPixels);
            let data = new ImageData(this.cvPixels, this.video.videoWidth, this.video.videoHeight);
            let markers = this.detector.detectFast(data);
            //context.clearRect(0, 0, this.video.videoWidth, this.video.videoHeight);
            //context.putImageData(data, 0, 0);*/
            context.drawImage(video, 0, 0, canvas.width, canvas.height);
            let imageData = context.getImageData(0, 0, canvas.width, canvas.height);
            let markers = this.detector.detect(imageData);

            this.printMarkers(markers);
            this.drawCorners(markers);
            let pose = this.getPose(markers);
            if (!(pose === null)) {
                updateObject(this.sceneRoot, this.modelSize, pose.bestRotation, pose.bestTranslation);
            }
            renderer.autoClear = false;
            renderer.clear();
            renderer.render(this.videoScene, this.videoCamera);
            renderer.render(this.parentScene, this.camera);
        }
        else {
            this.debugArea.innerHTML += "<p>Not enough video data: video state " + video.readyState + "</p>";
        }
        requestAnimationFrame(this.repaint.bind(this));
    }
}


class ARCanvasMultiAverage extends ARCanvas {
    /**
     * 
     * @param {string} divName The name of the div to which to add
     *                         this ARCanvas session
     * @param {object} scene An object containing a THREE.Group sceneRoot,
     * which is the root of the scene anchored to the markers, as well as
     * a step(dt) method which moves time forward for that scene
     * @param {float} modelSize Size of each marker in millimeters
     * @param {dict} config Aruco detector configuration parameters.  Can specify
     *                      "offsets": dictionary of offsets: marker ID -> [x, y, z]
     * @param {int} k Number of markers being used
     */
    constructor(divName, scene, modelSize=174.6, config={}) {
        super(divName, scene, modelSize, config);
        let markerHeight = config.markerHeight || 279.4; // 11" tall paper, in millimeters
        this.offsets = config.offsets || {
            "0":  [0, 0, -markerHeight*3],
            "4":  [0, 0, -markerHeight*2],
            "5":  [0, 0, -markerHeight*1],
            "11": [0, 0,  markerHeight*0],
            "23": [0, 0,  markerHeight*1],
            "26": [0, 0,  markerHeight*2],
            "69": [0, 0,  markerHeight*3]
        };
    }

    getPose(markers) {
        super.getPose(markers); // Update corners appropriately
        let pose = null;
        let q = glMatrix.quat.create();
        let t = glMatrix.vec3.create();
        // Step 1: Figure out average rotation
        if (markers.length > 0) {
            markers = [markers[0]];
        }
        let count = 0;
        for (let i = 0; i < markers.length; i++) {
            if (markers[i].id in this.offsets) {
                count++;
                pose = this.posit.pose(markers[i].corners);
                let ri = rot3dArr2glMatrix(pose.bestRotation);
                let qi = glMatrix.quat.create();
                glMatrix.quat.fromMat3(qi, ri);
                if (count == 1) {
                    q = qi;
                }
                else {
                    glMatrix.quat.slerp(q, q, qi, 1/count);
                }
            }
        }
        // Step 2: Figure out average translation
        count = 0;
        for (let i = 0; i < markers.length; i++) {
            if (markers[i].id in this.offsets) {
                count++;
                pose = this.posit.pose(markers[i].corners);
                let ti = pose.bestTranslation;
                // Subtract off offset in world coordinates
                let du = glMatrix.vec3.clone(this.offsets[markers[i].id]);
                glMatrix.vec3.transformQuat(du, du, q);
                //glMatrix.vec3.sub(ti, ti, du);
                if (count == 1) {
                    t = ti;
                }
                else {
                    glMatrix.vec3.add(t, t, ti);
                }
            }
        }
        if (count > 0) {
            glMatrix.vec3.scale(t, t, 1/count);
            let m = glMatrix.mat3.create();
            glMatrix.mat3.fromQuat(m, q);
            pose.bestTranslation = t;
            pose.bestRotation = glMatrix2Rot3dArr(m);
        }
        return pose;
    }
}


export {ARCanvas, ARCanvasMultiAverage};