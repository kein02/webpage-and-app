var DATA = {
  COLORS: {chest:"#ff6b6b",back:"#ffd93d",shoulders:"#6bcb77",arms:"#4d96ff",core:"#ff922b",glutes:"#cc5de8",fullbody:"#ff6b9d"},
  LABELS: {chest:"胸",back:"背",shoulders:"肩",arms:"臂",core:"核心",glutes:"臀",fullbody:"全身"},
  DAYS: ["周日","周一","周二","周三","周四","周五","周六"],
  EX: [
    {id:1,name:"标准俯卧撑",mg:"chest",diff:"中级",knee:true,desc:"双手略宽于肩，身体呈直线，核心收紧，下落至胸部接近地面。",tips:["保持核心收紧","手肘与身体夹角约45度","下落要慢，推起要快"],mistakes:["塌腰","抬头","手肘过度外展"],prog:["宽距俯卧撑","下斜俯卧撑","击掌俯卧撑"]},
    {id:2,name:"宽距俯卧撑",mg:"chest",diff:"中级",knee:true,desc:"双手间距比标准俯卧撑宽约20%，更多刺激胸肌外侧。",tips:["手肘夹角约60度","感受胸肌外侧拉伸","控制下落速度"],mistakes:["下落太快","肩关节过度压力"],prog:["钻石俯卧撑","弓箭手俯卧撑"]},
    {id:3,name:"钻石俯卧撑",mg:"chest",diff:"进阶",knee:true,desc:"双手拇指食指形成钻石形状，主要刺激胸肌中缝和三头肌。",tips:["保持手肘贴身体","下放到胸口碰到拳头即可","核心要绷住"],mistakes:["手肘过度外展","腰塌下去"],prog:["单臂俯卧撑(辅助)","负重俯卧撑"]},
    {id:4,name:"下斜俯卧撑",mg:"chest",diff:"中级",knee:true,desc:"脚放在椅子或床上，双手撑地，更多刺激上胸和三角肌前束。",tips:["脚抬高20-50cm","感受上胸发力","手肘与身体夹角45度"],mistakes:["肩胛骨过度前伸","下落过深导致肩痛"],prog:["更高角度","爆发式下斜"]},
    {id:5,name:"桌边臂屈伸",mg:"arms",diff:"中级",knee:true,desc:"双手撑在稳固的椅子或床边，身体下降再推起，主要练三头肌。",tips:["身体垂直下降","手肘向后","不要降到最低"],mistakes:["身体前倾太多","肩关节过度下拉"],prog:["平行凳臂屈伸","负重臂屈伸"]},
    {id:6,name:"俯卧YTW肩胛激活",mg:"back",diff:"初级",knee:true,desc:"俯卧，分别做Y、T、W三个字母形状的手臂抬起，激活肩胛稳定肌群。",tips:["每个动作停留2秒","用背部发力而非手臂","颈部放松"],mistakes:["用脖子发力","抬得太高导致代偿"],prog:["弹力带YTW","俯卧划船YTW"]},
    {id:7,name:"反向桌划船",mg:"back",diff:"中级",knee:true,desc:"钻到稳固的桌子下面，双手抓住桌沿，身体悬空拉起至胸口碰桌。",tips:["身体呈一直线","拉到胸口触碰桌沿","控制下放速度"],mistakes:["臀部下沉","半程完成"],prog:["单腿反向划船","手肘撑地划船"]},
    {id:8,name:"俯卧划船(书包负重)",mg:"back",diff:"中级",knee:true,desc:"俯卧，手持书包(装水瓶/书本)，做划船动作，刺激背阔肌。",tips:["手肘贴近身体","肩胛骨先收缩","控制节奏2-1-2"],mistakes:["用腰借力","耸肩"],prog:["单臂俯卧划船","增加书包重量"]},
    {id:9,name:"超人式",mg:"back",diff:"初级",knee:true,desc:"俯卧，同时抬起双臂和双腿，感受整个后链发力。",tips:["抬起时呼气","停留2秒","不要过度后仰"],mistakes:["脖子过度后仰","抬得太高导致腰伤"],prog:["超人式交换臂","超人式划船"]},
    {id:10,name:"死虫式",mg:"core",diff:"初级",knee:true,desc:"仰卧，四肢朝天，对侧手脚缓慢下放再还原，训练深层核心。",tips:["腰始终贴地","动作缓慢控制","呼吸配合"],mistakes:["腰离开地面","动作太快"],prog:["弹力带死虫","死虫推举"]},
    {id:11,name:"Pike俯卧撑",mg:"shoulders",diff:"中级",knee:true,desc:"身体呈倒V字形(臀部高位)，做俯卧撑，主要刺激三角肌。",tips:["臀部尽量抬高","手肘与身体夹角45度","头向地面方向下沉"],mistakes:["臀部不够高","肩关节过度挤压"],prog:["倒立撑(靠墙)","窄距Pike俯卧撑"]},
    {id:12,name:"侧平板支撑转肩",mg:"shoulders",diff:"中级",knee:true,desc:"侧平板姿势，下方手臂从身体下方穿过再打开，刺激肩部稳定性。",tips:["身体成一直线","旋转时跟随手臂","核心持续收紧"],mistakes:["臀部下沉","旋转幅度过大"],prog:["侧平板提膝","侧平板负重"]},
    {id:13,name:"侧平板V上举",mg:"shoulders",diff:"中级",knee:true,desc:"侧平板姿势，上方手臂向上举起再回到起始位置。",tips:["手臂伸直上举","身体不要前后晃动","每侧做同样次数"],mistakes:["身体向前翻转","肩膀下沉太多"],prog:["侧平板转体","侧平板负重"]},
    {id:14,name:"平板支撑",mg:"core",diff:"初级",knee:true,desc:"肘撑地面，身体成一直线，保持静止，训练核心稳定性。",tips:["收紧臀部和腹部","不要撅屁股","正常呼吸"],mistakes:["臀部过高","塌腰","憋气"],prog:["侧平板","动态平板","加重平板"]},
    {id:15,name:"臀桥",mg:"glutes",diff:"初级",knee:true,desc:"仰卧屈膝，双脚踩地，用臀部发力将髋部抬起至身体成直线。",tips:["顶峰收缩1秒","用脚跟发力","不要过度顶腰"],mistakes:["过度顶腰(弓背)","用小腿发力"],prog:["单腿臀桥","负重臀桥","臀桥提膝"]},
    {id:16,name:"单腿臀桥",mg:"glutes",diff:"中级",knee:true,desc:"在臀桥基础上，一条腿伸直悬空，用单腿完成臀桥。",tips:["伸直腿不要翘太高","重心在支撑脚","顶峰收缩"],mistakes:["支撑腿膝盖内扣","身体旋转"],prog:["单腿臀桥脉冲","单腿单脚臀桥"]},
    {id:17,name:"蚌式开合",mg:"glutes",diff:"初级",knee:true,desc:"侧卧，双膝弯曲，像蚌壳一样打开上方膝盖，训练臀中肌。",tips:["双脚并拢不分开","臀部上方发力","骨盆不要翻转"],mistakes:["骨盆滚动","打开幅度过大导致腰疼"],prog:["蚌式负重","站立蚌式弹力带"]},
    {id:18,name:"侧卧抬腿",mg:"glutes",diff:"初级",knee:true,desc:"侧卧，下方手支撑头部，上方腿伸直向上抬起，练臀中肌。",tips:["脚尖微朝下","抬到45度即可","控制下放速度"],mistakes:["身体向前翻转","抬得太高导致代偿"],prog:["侧卧抬腿脉冲","侧卧交叉抬腿"]},
    {id:19,name:"鸟狗式",mg:"core",diff:"初级",knee:true,desc:"四足跪姿，同时伸出一臂和对侧腿，保持平衡，训练核心稳定性。",tips:["身体成直线","停留2秒","不要塌腰"],mistakes:["躯干旋转","臀部过高或过低"],prog:["鸟狗式推举","鸟狗式脉冲"]},
    {id:20,name:"Mountain climbers(慢速)",mg:"fullbody",diff:"中级",knee:true,desc:"俯卧撑姿势，慢速交替将膝盖提向胸口，低冲击版本无跳跃。",tips:["身体稳定不要晃动","核心收紧","慢速控制"],mistakes:["屁股翘太高","动作失控变快"],prog:["快速Mountain climbers","负重Mountain climbers"]},
    {id:21,name:"简化Burpee(无跳)",mg:"fullbody",diff:"中级",knee:true,desc:"俯卧撑姿势→下蹲→站起→上举双手，无跳跃版本保护膝盖。",tips:["动作流畅连贯","核心始终收紧","落地轻柔"],mistakes:["落地过重","背部弯曲"],prog:["带俯卧撑Burpee","带跳跃Burpee"]},
    {id:22,name:"毛巾战绳",mg:"fullbody",diff:"初级",knee:true,desc:"坐姿或站姿，手持毛巾两端，快速交替上下甩动毛巾，模拟战绳。",tips:["用手臂和肩部发力","核心收紧保持稳定","持续节奏"],mistakes:["只用手腕","身体过度摇晃"],prog:["站立毛巾战绳","双毛巾交替"]},
    {id:23,name:"仰卧单车",mg:"core",diff:"初级",knee:true,desc:"仰卧，交替用肘碰对侧膝盖，模拟蹬自行车动作。",tips:["慢速控制","肩胛离地","不要拉脖子"],mistakes:["脖子发力","腿太快失去效果"],prog:["负重仰卧单车","静态保持单车"]}
  ],
  PLANS: [
    {id:"chest",name:"胸 + 三头",day:1,ex:[
      {n:"标准俯卧撑",s:4,r:12,rest:60,eid:1},
      {n:"宽距俯卧撑",s:3,r:10,rest:60,eid:2},
      {n:"钻石俯卧撑",s:3,r:8,rest:45,eid:3},
      {n:"下斜俯卧撑",s:3,r:10,rest:45,eid:4},
      {n:"桌边臂屈伸",s:3,r:12,rest:30,eid:5}
    ]},
    {id:"back",name:"背 + 二头",day:2,ex:[
      {n:"俯卧YTW肩胛激活",s:3,r:10,rest:30,eid:6},
      {n:"反向桌划船",s:4,r:10,rest:60,eid:7},
      {n:"俯卧划船(书包负重)",s:4,r:12,rest:60,eid:8},
      {n:"超人式",s:3,r:12,rest:30,eid:9},
      {n:"死虫式",s:3,r:10,rest:30,eid:10}
    ]},
    {id:"shoulders",name:"肩部 + 核心",day:3,ex:[
      {n:"Pike俯卧撑",s:4,r:8,rest:60,eid:11},
      {n:"侧平板支撑转肩",s:3,r:8,rest:30,eid:12},
      {n:"侧平板V上举",s:3,r:10,rest:30,eid:13},
      {n:"死虫式",s:3,r:10,rest:30,eid:10},
      {n:"平板支撑",s:3,r:30,rest:30,eid:14}
    ]},
    {id:"glutes",name:"臀 + 腿(髋主导)",day:4,ex:[
      {n:"臀桥",s:4,r:15,rest:45,eid:15},
      {n:"单腿臀桥",s:3,r:10,rest:45,eid:16},
      {n:"侧卧抬腿",s:3,r:15,rest:30,eid:18},
      {n:"蚌式开合",s:3,r:15,rest:30,eid:17},
      {n:"鸟狗式",s:3,r:10,rest:30,eid:19}
    ]},
    {id:"fullbody",name:"全身代谢",day:5,ex:[
      {n:"Mountain climbers(慢速)",s:4,r:20,rest:30,eid:20},
      {n:"简化Burpee(无跳)",s:3,r:8,rest:60,eid:21},
      {n:"俯卧撑",s:3,r:10,rest:45,eid:1},
      {n:"毛巾战绳",s:3,r:20,rest:30,eid:22},
      {n:"仰卧单车",s:3,r:20,rest:30,eid:23}
    ]}
  ],
  defaultSettings: {restSeconds:60,weight:70,height:170,age:25,diff:"中级",knee:true}
};
