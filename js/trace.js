export class AimTrace {

    constructor(){
        this.points=[];
    }


    reset(){
        this.points=[];
    }


    add(x,y){
        this.points.push({
            x,
            y,
            time:performance.now()
        });
    }


    draw(){

        const canvas=document.createElement("canvas");

        canvas.width=800;
        canvas.height=600;

        canvas.style.position="fixed";
        canvas.style.left="50%";
        canvas.style.top="50%";
        canvas.style.transform=
            "translate(-50%,-50%)";

        canvas.style.background="#111";
        canvas.style.zIndex="9999";


        document.body.appendChild(canvas);


        const ctx=canvas.getContext("2d");


        ctx.strokeStyle="#00ff88";
        ctx.lineWidth=2;


        ctx.beginPath();


        this.points.forEach((p,i)=>{

            if(i===0)
                ctx.moveTo(p.x,p.y);
            else
                ctx.lineTo(p.x,p.y);

        });


        ctx.stroke();


        // 5秒后关闭
        setTimeout(()=>{
            canvas.remove();
        },5000);

    }

}


export const aimTrace =
new AimTrace();
