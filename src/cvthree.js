/* Copyright (c) 2023 Christopher Tralie
* Re-implementations of some of the above operations
* as GLSL shaders
*/

// Color to grayscale conversion
CV.GrayscaleAndFlipShader = {
    uniforms: {
        'tDiffuse': { value: null }
    },
    vertexShader: `
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
        }`,
  
    fragmentShader: /* glsl */`
        #include <common>
        uniform sampler2D tDiffuse;
        varying vec2 vUv;
        void main() {
            vec2 uv = vUv;
            // Flip upside down because aruco is upside down with
            // respect to the gl canvas
            uv.y = 1.0-uv.y; 
            vec4 texel = texture2D( tDiffuse, uv );
            float l = 0.299*texel.r + 0.587*texel.g + 0.114*texel.b;
            gl_FragColor = vec4( l, l, l, texel.w );
        }`
  };