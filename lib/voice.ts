import {PROMPTS,spokenCharacters} from './domain.mjs';
import {mediaUrl,type Appliance} from './types';
let audio:HTMLAudioElement|null=null;
export function stopSpeaking(){audio?.pause();audio=null;if('speechSynthesis'in window)window.speechSynthesis.cancel();}
export function speak(text:string){stopSpeaking();if(!('speechSynthesis'in window))throw Error('Readback is unavailable in this browser. All details are shown on screen.');const u=new SpeechSynthesisUtterance(text);u.rate=.86;u.lang='en-US';window.speechSynthesis.speak(u);}
export async function playPrompt(key:string,recordings:Record<string,string>){stopSpeaking();const path=recordings[key];if(path){audio=new Audio(mediaUrl(path));try{await audio.play()}catch{throw Error('Tap the instruction button again to play this recording.')}}else{const prompt=PROMPTS.find(p=>p.key===key);if(prompt)speak(prompt.text);}}
export function readback(r:Appliance){speak([r.inventoryId,r.brand,r.type,'Model: '+spokenCharacters(r.model),'Serial: '+spokenCharacters(r.serial),'Condition: '+r.condition,'Testing: '+r.testStatus,'Location: '+[r.location,r.bin].filter(Boolean).join(', '),r.price?'Selling price: '+r.price+' dollars':'Selling price is not set',r.notes].filter(Boolean).join('. '));}
export function startDictation(onResult:(text:string)=>void,onEnd:()=>void,onError:(s:string)=>void):()=>void{
 stopSpeaking();const C=(window as any).SpeechRecognition||(window as any).webkitSpeechRecognition;
 if(!C){onError('Use the microphone on your phone keyboard to dictate into this field, or type.');onEnd();return ()=>{}}
 const r=new C();r.lang='en-US';r.continuous=false;r.interimResults=false;r.maxAlternatives=1;
 r.onresult=(e:any)=>onResult(e.results[0][0].transcript);r.onend=onEnd;
 r.onerror=(e:any)=>{onError(e.error==='not-allowed'?'Microphone access was declined. Use your keyboard microphone or type.':'Speech was not captured. Try again, use your keyboard microphone, or type.');onEnd()};
 try{r.start()}catch{onError('Speech input could not start. Use your keyboard microphone or type.');onEnd()}
 return ()=>{r.abort();onEnd()};
}
