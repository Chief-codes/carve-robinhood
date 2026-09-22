// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;
import {CarveBuybackPolicy} from "../src/CarveBuybackPolicy.sol";

contract CarveBuybackPolicyTest {
    function testOnePercentCreatorFeeExample() public pure {
        (uint256 revenue,uint256 buyback)=CarveBuybackPolicy.split(0.01 ether);
        require(revenue==0.002 ether && buyback==0.008 ether,"20/80 split");
        require(revenue+buyback+0.01 ether==0.02 ether,"Carve 1% stays separate");
    }
    function testDustReservedForBuybacks() public pure {
        (uint256 revenue,uint256 buyback)=CarveBuybackPolicy.split(1);
        require(revenue==0 && buyback==1,"no dust loss");
    }
    function testFuzzNoFeeLostOrOverallocated(uint256 fee) public pure {
        (uint256 revenue,uint256 buyback)=CarveBuybackPolicy.split(fee);
        require(revenue+buyback==fee,"conservation");
        require(revenue==fee/5,"20 percent");
    }
}
