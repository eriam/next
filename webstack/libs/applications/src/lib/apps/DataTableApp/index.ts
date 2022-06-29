// import {SBPrimitive} from "../../../../../sagebase/src/lib/modules";

export type state = {
    messages: string;
    inputVal: string;
    items: any;
    loaded: boolean;
    headers: string[];
    clicked: boolean;
    selected: any[];
    checkedItems: string[];
    // data: {key: any, value: any};
};


export const init: Partial<state> = {
    // items: [],
    loaded: false,
    // headers: [],
    clicked: false,
    // selected is some dict with column true
    // selected: {"email": false},
    // selected: [],
    checkedItems: [],
};


export const name = "DataTable";
