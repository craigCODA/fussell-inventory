export function rotationLayout(width,height,turns){const q=((turns%4)+4)%4;return {width:q%2?height:width,height:q%2?width:height,angle:q*Math.PI/2};}
